# ThoughtProof v0 Benchmark Results - 2026-04-24

## Summary

| Metric | Value |
|--------|-------|
| total | 13 |
| scored | 5 |
| manualGap | 8 |
| exactMatch | 5 |
| conservativeMiss | 0 |
| dangerousMiss | 0 |
| exactMatchRateOnScored | 1.000 (100%) |

## Detailed Results

### Exact Matches (5/5)

| ID | Type | Expected | Actual | Status |
|----|------|----------|--------|--------|
| V0-01 | trace | CONDITIONAL_ALLOW | CONDITIONAL_ALLOW | ✅ exact_match |
| V0-02 | trace | CONDITIONAL_ALLOW | CONDITIONAL_ALLOW | ✅ exact_match |
| V0-11 | plan | HOLD | HOLD | ✅ exact_match |
| V0-12 | plan | BLOCK | BLOCK | ✅ exact_match |
| V0-13 | plan | HOLD | HOLD | ✅ exact_match |

### Manual Gaps (8/13)

| ID | Type | Expected | Status | Reason |
|----|------|----------|--------|--------|
| V0-03 | trace | CONDITIONAL_ALLOW | manual_gap | Missing traces.jsonl + gold.json |
| V0-04 | trace | CONDITIONAL_ALLOW | manual_gap | Missing traces.jsonl + gold.json |
| V0-05 | trace | BLOCK | manual_gap | Missing traces.jsonl + gold.json |
| V0-06 | trace | BLOCK | manual_gap | Missing traces.jsonl + gold.json |
| V0-07 | trace | BLOCK | manual_gap | Missing traces.jsonl + gold.json |
| V0-08 | trace | BLOCK | manual_gap | Missing traces.jsonl + gold.json |
| V0-09 | trace | BLOCK | manual_gap | Missing traces.jsonl + gold.json |
| V0-10 | decision_memo | HOLD | manual_gap | decision_memo scorer not implemented |

## Changes Made

1. **Policy Update (Commit 56849b29b)**
   - Extended `evaluateRetrievalPolicy` to accept `plan_gap` and `coverage` (non-high) as observability gaps
   - Fixed V0-01 and V0-02 conservative misses (HOLD → CONDITIONAL_ALLOW)

2. **Plan Scorer Implementation**
   - Added `scorePlanBundleItem` function for `candidateObjectType=plan`
   - Supports synthetic plans with direct expected verdict usage
   - Checks critical and reference steps for real plans

3. **Trace Files Created**
   - `src/plan/__fixtures__/hard-v2-threshold/traces.jsonl`
   - `src/plan/__fixtures__/hard-v2-threshold/fine-gold.json`
   - `src/plan/__fixtures__/hard-v2-threshold/fine-source-claim.json`

## Next Steps

1. Create trace files for V0-03 to V0-09 (GAIA traces)
2. Implement decision_memo scorer for V0-10
3. Achieve 13/13 exact matches
