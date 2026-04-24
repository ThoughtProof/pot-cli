# Benchmark v0 combined summary — 2026-04-24

## Inputs
- `tmp/benchmark-v0-wave1-generated-traces-2026-04-23.jsonl`
- `tmp/benchmark-v0-wave2-generated-traces-2026-04-23.jsonl`
- `tmp/benchmark-v0-wave1.gold-map.json`
- `tmp/benchmark-v0-wave2.gold-map.json`

## Derived artifacts
- `tmp/benchmark-v0-wave1-enriched-2026-04-24.jsonl`
- `tmp/benchmark-v0-wave2-enriched-2026-04-24.jsonl`
- `tmp/benchmark-v0-wave1-source-claim-2026-04-24.json`
- `tmp/benchmark-v0-wave2-source-claim-2026-04-24.json`
- `tmp/benchmark-v0-wave1-policy-source-claim-2026-04-24.json`
- `tmp/benchmark-v0-wave2-policy-source-claim-2026-04-24.json`
- `tmp/benchmark-v0-combined-enriched-2026-04-24.jsonl`
- `tmp/benchmark-v0-combined-source-claim-2026-04-24.json`
- `tmp/benchmark-v0-combined-policy-source-claim-2026-04-24.json`

## Source-claim support
Aggregate across the 4 combined cases:
- exact: 0
- paraphrase: 1
- unsupported: 3

Per case:
- `V0-05` → unsupported
- `V0-09` → paraphrase
- `V0-13` → unsupported
- `V0-14` → unsupported

## Policy result with experimental source-claim map
Combined policy output:
- count: 4
- ALLOW: 0
- CONDITIONAL_ALLOW: 0
- HOLD: 0
- BLOCK: 4

Per case:
- `V0-05` → BLOCK (`factual_failure`)
- `V0-09` → BLOCK (`factual_failure`)
- `V0-13` → BLOCK (`factual_failure`, plus `truly_missing_step x1`)
- `V0-14` → BLOCK (`factual_failure`)

## Takeaway
This combined v0 run confirms the intended boundary: experimental source-claim support does not soften real factual-failure cases. Even after source-page enrichment and combined source-claim injection, the combined v0 bundle remains `BLOCK=4/4` with no ALLOW / CONDITIONAL_ALLOW / HOLD transitions.

This is a useful negative-control style result for the current source-claim path: it preserves hard stops on wrong-answer traces rather than washing them out.
