# Benchmark v2 broken dependency chain — calibration note (2026-04-24)

## Current formal scorer readout
Using:
- `benchmark-v2-broken-dependency-chain-bundle-2026-04-24.jsonl`
- `benchmark-v2-broken-dependency-chain-traces-firstparty-2026-04-24.jsonl`
- `benchmark-v2-broken-dependency-chain-gold-2026-04-24.json`

Current `plan-score-benchmark` result:
- `exactMatch = 2`
- `conservativeMiss = 1`
- `dangerousMiss = 1`
- `manualGap = 0`

## Per-case status
- `V2-C01` expected `BLOCK` -> actual `BLOCK` ✅
- `V2-C02` expected `HOLD` -> actual `CONDITIONAL_ALLOW` ⚠️ dangerous miss
- `V2-C03` expected `HOLD` -> actual `BLOCK` ⚠️ conservative miss
- `V2-C04` expected `BLOCK` -> actual `BLOCK` ✅

## Interpretation
### Stable anchors
`V2-C01` and `V2-C04` are stable structural BLOCK anchors for the `v2_broken_dependency_chain` family.

### Accepted conservative miss
`V2-C03` is currently acceptable as a conservative miss:
- the case is structurally near-complete
- the scorer still hardens it to `BLOCK`
- this is over-conservative, not under-protective

### Active calibration probe
`V2-C02` should be treated as an active calibration probe rather than as a drafting mistake.

Observed behavior:
- first version scored as `BLOCK`
- after answer/gold equivalence tightening it moved to `CONDITIONAL_ALLOW`
- minimal ordering-emphasis redraft did not bring it back to `HOLD`

Meaning:
- `V2-C02` is a genuine knife-edge middle-case
- the current policy/scorer path does not yet cleanly represent **wrong-order dependency** as a sufficiently strong HOLD-inducing structural defect when the answer is otherwise well-supported and factually correct

## Practical conclusion
The current v2 family is still valuable and should be retained as the first scorer-runnable `broken dependency chain / global structure` slice.

Recommended current status:
- keep `V2-C01` and `V2-C04` as stable BLOCK anchors
- keep `V2-C03` as an accepted conservative miss
- keep `V2-C02` as an explicit policy-gap / calibration probe

## Why this matters
This is not noise.
It reveals a meaningful current boundary in ThoughtProof v2:
- the system strongly catches missing prerequisites and global over-claims
- but wrong-order epistemic defects are not yet robustly separated from well-supported correct answers

That is exactly the kind of signal a benchmark family is supposed to surface.
