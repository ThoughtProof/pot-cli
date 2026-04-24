# PLV Pilot Phase 4 — Parser Robustness Analysis (2026-04-24)

## Purpose
Test whether the PLV signal holds when plans are **model-extracted** instead of human-curated (gold). This is the critical reality check: in production, no one writes gold plans.

---

## Design

### Two plan sources, same 15 items
1. **Gold plans** — human-curated step graphs with criticality tags (Phase 2 baseline)
2. **Model-extracted plans** — steps extracted by a language model from the raw traces

### Parser specification
For this analysis, the "parser" is a prompted language model that:
1. Reads the raw trace (steps with kind/text/tool fields)
2. Extracts a step graph with descriptions
3. Assigns criticality tags (critical / supporting / optional)
4. Assigns support predicates (supported / unsupported / skipped)

### Agreement metrics
| Metric | Definition |
|---|---|
| **Step agreement** | Do gold and model-extracted plans identify the same steps? |
| **Criticality agreement** | Do they assign the same criticality tags? |
| **Support agreement** | Do they assign the same support predicates? |
| **Verdict agreement** | Does the PLV verdict change when using model-extracted plans? |

---

## Risk Model

### What can go wrong

#### 1. Step fragmentation
Model extracts too many or too few steps compared to gold.

**Impact:** If a critical step is merged with a supporting step, the criticality signal is diluted. If a step is split into sub-steps, n-inflation occurs.

**Mitigation:** Normalize step count by comparing semantic coverage, not 1:1 step matching.

#### 2. Criticality misassignment
Model tags a critical step as supporting, or vice versa.

**Impact:** This is the most dangerous failure mode. If the skipped safeguard in V3-01 is tagged "supporting" instead of "critical", PLV would incorrectly soften to HOLD.

**Mitigation:** Anchor criticality assignment to the gold step graph's critical steps. Measure agreement specifically on the gold-critical steps.

#### 3. Support predicate noise
Model sees a step as "supported" when gold says "skipped" (or vice versa).

**Impact:** Changes the PLV verdict directly. A step marked "supported" instead of "skipped" removes a BLOCK signal.

**Mitigation:** Measure support-predicate agreement specifically on gold-critical steps.

#### 4. Trace quality variation
Some traces are cleaner than others. Parser may work well on structured traces and fail on messy ones.

**Impact:** Family-specific accuracy differences.

**Mitigation:** Report per-family parser agreement, not just aggregate.

---

## Expected Outcomes (preregistered)

### Optimistic scenario
Model-extracted plans agree with gold on all 15 items at the verdict level. Parser noise exists at step/criticality level but does not propagate to verdict changes.

**Probability estimate:** ~40%

### Realistic scenario
Model-extracted plans agree on 12–14 items. 1–3 items show verdict changes, concentrated in the harder C-family cases (V2-C02, V2-C03) where criticality discrimination is essential.

**Probability estimate:** ~45%

### Pessimistic scenario
Model-extracted plans agree on fewer than 12 items. Parser noise propagates to multiple verdict changes, including in the B or D families where gold-plan PLV was clean.

**Probability estimate:** ~15%

---

## How To Run This (Protocol)

### Step 1 — Extract plans
For each of the 15 items, prompt a model with:
```
Given this agent trace, extract the reasoning plan as a sequence of steps.
For each step, provide:
- index (sequential)
- description (what the step does)
- criticality: "critical" (load-bearing for the conclusion), "supporting" (strengthens but not decisive), or "optional"
- support: "supported" (evidence exists in trace), "unsupported" (no evidence), or "skipped" (required but never executed)
```

### Step 2 — Compare to gold
For each item, compute:
- Step-level semantic overlap (how many gold steps are covered)
- Criticality agreement on gold-critical steps
- Support agreement on gold-critical steps

### Step 3 — Re-run PLV with model-extracted plans
Apply the same PLV verdicting logic using model-extracted plans instead of gold plans.

### Step 4 — Measure verdict stability
Count how many items change verdict between gold-PLV and model-PLV.

### Step 5 — Report
Per-family agreement rates + verdict stability + failure analysis on any changed items.

---

## Decision Criteria

### Green light for production PLV
- Verdict agreement ≥ 13/15 (87%)
- No D-family verdict changes (negative controls hold)
- No H-family dangerous softening (boundary controls hold)
- Criticality agreement on gold-critical steps ≥ 80%

### Yellow light (proceed with caution)
- Verdict agreement 11–12/15
- Some C-family instability but D and H hold
- Criticality agreement 60–80%

### Red light (PLV needs gold plans in production)
- Verdict agreement < 11/15
- D or H family verdict changes
- Criticality agreement < 60%

---

## Practical Implication

### If green
PLV can ship with model-extracted plans. The parser is robust enough.

### If yellow
PLV ships but with a **confidence flag**: when parser confidence is low, fall back to answer-level verification or flag for human review.

### If red
PLV requires gold plans or a significantly better parser before production. Ship it as a **premium tier** with human-curated plan input.

---

## Honest Assessment Before Running

The two divergent cases (V2-C02, V2-C03) are the hardest for a parser because:
- V2-C02 requires detecting **ordering** violations, not just missing steps
- V2-C03 requires distinguishing **critical vs supporting** gaps

These are exactly the cases where parser noise is most likely to destroy the signal.

My prediction: **realistic scenario** (12–14/15 agreement). The B, D, and H families should be stable because the step structures are cleaner. The C family is where parser robustness will be tested.

---

## Next Step
Run the actual model-extraction pass on all 15 items and compare to gold.

_This protocol document was written before execution to prevent post-hoc rationalization._
