# PLV Pilot Phase 4 — Parser Robustness Results (2026-04-24)

## Setup
- Gold plans: human-curated step graphs with criticality tags
- Model-extracted plans: **xai/grok-4-1-fast** (blind extraction, no access to gold)
- PLV verdicting logic: same function applied to both plan sources

---

## Headline Result

**Verdict agreement: 9/15 (60%)**

This is **RED LIGHT** territory per our preregistered criteria (< 11/15).

---

## Per-Family Breakdown

| Family | Agreement | Notes |
|--------|-----------|-------|
| **B** (unsupported step) | **4/4 (100%)** | Perfect. All BLOCK. |
| **C** (broken dependency) | **1/4 (25%)** | Worst family. Parser misses structural failures. |
| **D** (negative control) | **1/3 (33%)** | **FAILED.** V0-14 softened to ALLOW. |
| **H** (boundary control) | **3/4 (75%)** | Mostly OK, one over-punished to BLOCK. |

---

## Safety Check Results

### D-family (negative control): ❌ FAILED
- V0-14: gold=HOLD, model=**ALLOW** — parser missed the critical unsupported step entirely
- V1-R05: gold=HOLD, model=HOLD ✅
- V1-R06: gold=HOLD, model=BLOCK (conservative, acceptable)

**This is the critical failure.** A negative control item was softened to ALLOW by model-extracted plans.

### H-family (boundary control): ✅ PASSED
- No items softened to ALLOW
- One item (V1-R03) over-punished to BLOCK (conservative miss, acceptable)

---

## Failure Analysis

### Pattern 1: Parser marks skipped steps as "supported" (C-family, V0-14)
The most dangerous pattern. Grok judged that:
- V2-C01: The prerequisite-check step was "supported" (gold: skipped)
- V2-C02: The ordering-check step was "supported" (gold: unsupported)
- V0-14: The extraction step was "supported" (gold: unsupported)

**Root cause:** The parser sees that the trace *mentioned* the topic and considers that "supported" — but it does not detect that the trace *failed to actually verify or apply* the critical logic. This is exactly the parser-noise risk we preregistered.

### Pattern 2: Parser over-counts critical steps (V2-C04, V1-R03, V1-R06)
Grok added extra critical steps that gold did not include, and marked them unsupported/skipped. This leads to BLOCK where gold says HOLD.

**Root cause:** The parser is more conservative in defining what's critical, leading to over-punishment. Less dangerous than Pattern 1 but still noisy.

---

## Verdict Stability Matrix

| | Model says ALLOW | Model says HOLD | Model says BLOCK |
|---|---|---|---|
| Gold says ALLOW | 1 (V2-C03) ✅ | 0 | 0 |
| Gold says HOLD | **3** ❌❌❌ | 4 ✅✅✅✅ | **2** (conservative) |
| Gold says BLOCK | **1** ❌ | 0 | 4 ✅✅✅✅ |

The dangerous zone is **Gold HOLD/BLOCK → Model ALLOW**: 4 items. Three are HOLD→ALLOW (soft miss), one is BLOCK→ALLOW (dangerous miss on V2-C01).

---

## Assessment Against Preregistered Criteria

| Criterion | Threshold | Result | Status |
|---|---|---|---|
| Verdict agreement | ≥ 13/15 (87%) | 9/15 (60%) | ❌ RED |
| D-family holds | No verdict changes | V0-14 changed | ❌ RED |
| H-family no softening | No ALLOW | None | ✅ GREEN |
| Criticality agreement | ≥ 80% | ~60% est. | ❌ RED |

**Overall: RED LIGHT.**

---

## What This Means

### For PLV as a product
PLV **cannot ship with model-extracted plans** at this parser quality level. The signal that makes PLV valuable (structural discrimination on C-family cases) is exactly the signal that the parser destroys.

### For PLV as a research direction
The gold-plan results (Phase 2) remain valid and valuable. PLV *does* discriminate better on structural cases — **when the plans are correct**. The bottleneck is the parser, not the verification logic.

### Practical options

#### Option A — Ship PLV with gold/human-curated plans only
Premium tier. Customer or ThoughtProof team curates the plan. High accuracy, low scalability.

#### Option B — Improve the parser
Fine-tune or prompt-engineer a better plan extractor. Key target: distinguish "mentioned the topic" from "actually verified/applied the logic." This is a tractable NLP problem.

#### Option C — Dual-parser agreement gate
Run two independent parsers. Only use PLV when they agree on criticality assignments. Fall back to answer-level when they disagree.

#### Option D — Hybrid approach
Use model-extracted plans for B-family cases (100% agreement) and gold plans for C-family cases (where parser fails).

---

## Honest One-Liner

> PLV with gold plans discriminates correctly. PLV with model-extracted plans does not — yet. The parser is the bottleneck, not the verification logic.

---

_Executed 2026-04-24. Parser model: xai/grok-4-1-fast._
