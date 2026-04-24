# Benchmark v0 family split note — 2026-04-24

## Key clarification
There are currently **two different benchmark families** in active use that both reuse `V0-*` style labels, but they do **not** refer to the same underlying cases.

## Family A — GAIA / fixture-backed v0 bundle
Primary artifact:
- `tmp/benchmark-v0-plan-level-2026-04-23.jsonl`

Trace items in this bundle resolve against fixture artifacts such as:
- `src/plan/__fixtures__/gaia-v0-traces.jsonl`
- `src/plan/__fixtures__/gaia-v0-gold.json`
- `src/plan/__fixtures__/gaia-v0-source-claim.json`

Example:
- `V0-05` in this family = GAIA provenance-mismatch case
- `candidateObjectRef/sourceRef = 46719c30-f4c3-4cad-be07-d5cb21eee6bb`

## Family B — generated wave benchmark
Primary artifacts:
- `tmp/benchmark-v0-wave1-generated-traces-2026-04-23.jsonl`
- `tmp/benchmark-v0-wave2-generated-traces-2026-04-23.jsonl`

These records are keyed by `task_id` values like `V0-05`, `V0-09`, `V0-13`, `V0-14`, but the underlying tasks are different from the GAIA fixture bundle.

Example:
- `V0-05` in this family = Declaration of Independence signing-date / July 4 supportability task
- not the GAIA provenance-mismatch case

## Why this matters
The apparent contradiction between:
- direct `plan-policy` runs on generated wave traces, and
- `plan-score-benchmark` runs on the GAIA fixture bundle

was not just a scorer-mode issue. In multiple comparisons, we were evaluating **different underlying records that happened to share the same `V0-*` label**.

## Practical rule going forward
Do **not** directly compare verdicts across these families by `V0-*` label alone.

Instead, compare only when one of the following matches:
- same bundle family
- same trace source corpus
- same unique trace/source identifier

## Recommended next step
Keep the families separate and explicit:
- treat `benchmark-v0-plan-level-2026-04-23.jsonl` as the **GAIA/fixture benchmark track**
- treat `benchmark-v0-wave1/2-generated-traces-*` as the **generated-wave benchmark track**

If one family becomes canonical later, rename or re-ID the other track to eliminate label collision.
