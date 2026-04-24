# Benchmark v1 retrieval-boundary results — 2026-04-24

## Summary
Combined sanity/policy read over the first operational v1 retrieval-boundary slice:
- `CONDITIONAL_ALLOW`: 2
- `HOLD`: 2
- `BLOCK`: 2

## Per-case results
- `V1-R01` → `CONDITIONAL_ALLOW`
- `V1-R02` → `CONDITIONAL_ALLOW`
- `V1-R03` → `HOLD`
- `V1-R04` → `HOLD`
- `V1-R05` → `BLOCK`
- `V1-R06` → `BLOCK`

## Interpretation
This is the first fully functioning 6-case v1 retrieval-boundary slice with all three target verdict bands represented and sanity-checked through the current first-party policy path.

### What the slice now demonstrates
- **Softening anchors work:**
  - first-party retrieval with correct answer + one missing decisive support step can land in `CONDITIONAL_ALLOW`
- **Conservative retrieval holds work:**
  - plausible, likely-correct retrieval with unresolved observability gaps can remain `HOLD`
- **Hard-stop guards work:**
  - retrieval-shaped factual failures and provenance mismatches still `BLOCK`

## Notable design lessons
- Abstract placeholder phrasing was too unstable for `V1-R04`; converting it to a concrete CDC opioid-guidance case stabilized the intended `HOLD` behavior.
- The slice is therefore not just a content benchmark but also an informative probe of task-typing and trace-shape sensitivity.

## Backing artifacts
- Family artifact: `tmp/benchmark-v1-retrieval-boundary-family-2026-04-24.json`
- Combined traces: `tmp/benchmark-v1-retrieval-boundary-traces-2026-04-24.jsonl`
- Combined gold: `tmp/benchmark-v1-retrieval-boundary-gold-2026-04-24.json`
