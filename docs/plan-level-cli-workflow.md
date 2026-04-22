# Plan-Level CLI Workflow

Date: 2026-04-21
Status: local workflow notes for plan-level verification experiments

## Purpose
This document captures the current first-class CLI workflow for local plan-level verification experiments.
It replaces the earlier pattern of one-off enrichment and policy rerun scripts.

## Core commands
### 1. Enrich first-party traces with gold/reference metadata
```bash
node dist/index.js plan-enrich-first-party <input.jsonl> \
  --gold-map <gold-map.json> \
  --out <enriched.jsonl>
```

### 2. Build canonical PlanRecords + benchmark coverage
```bash
node dist/index.js plan-benchmark <enriched.jsonl> \
  --json \
  --out <benchmark.json> \
  --plan-records-out <plan-records.json>
```

### 3. Optional: enrich browse evidence from source pages
```bash
node dist/index.js plan-enrich-source-pages <input.jsonl> \
  --out <source-page-enriched.jsonl>
```

This enriches browse evidence with fetched source-page metadata, currently `<title>`, `<h1>`, and a narrow acronym-aware page-text fallback for true `what does X stand for` questions.
It is useful when lean first-party traces under-expose exact source text.

### 4. Build a source-claim map from first-party traces
```bash
node dist/index.js plan-build-source-claim-map <input.jsonl> \
  --gold-map <gold-map.json> \
  --out <source-claim-map.json>
```

Or collapse the source-page enrichment directly into the build step:
```bash
node dist/index.js plan-build-source-claim-map <input.jsonl> \
  --gold-map <gold-map.json> \
  --enrich-source-pages \
  --out <source-claim-map.json>
```

Current rule: source-claim derivation is intentionally conservative and uses trace `evidence` fields as source text. Agent summaries and notes are not treated as source evidence. The optional source-page enrichment path only adds fetched page metadata or narrow acronym expansions from the source page itself. It does not use the agent answer as source evidence.
Generated source-claim maps now also preserve `explanation` and optional `matchedSpan` fields for debugging/auditability.

### 5. Baseline policy evaluation
```bash
node dist/index.js plan-policy <plan-records.json> \
  --json \
  --mode semantic \
  --out <policy.json>
```

### 6. Policy evaluation with experimental source-claim support
```bash
node dist/index.js plan-policy <plan-records.json> \
  --json \
  --mode semantic \
  --experimental-source-claim-map <source-claim-map.json> \
  --out <policy-source-claim.json>
```

### 7. Multi-profile first-party sweep (for reference granularity or similar profile comparisons)
```bash
node dist/index.js plan-sweep-first-party <input.jsonl> \
  --profiles <profiles.json> \
  --source-claim-map <source-claim-map.json> \
  --out <sweep.json>
```

Or derive source-claim plus source-page enrichment directly inside the sweep:
```bash
node dist/index.js plan-sweep-first-party <input.jsonl> \
  --profiles <profiles.json> \
  --enrich-source-pages \
  --out <sweep.json>
```

Or for a compact human-readable report to stdout:
```bash
node dist/index.js plan-sweep-first-party <input.jsonl> \
  --profiles <profiles.json> \
  --format text
```

You can still write either JSON or text output to a file with `--out <file>`.

The sweep output now includes both full per-profile reports and a compact `summary` section with:
- `baselineVerdictCounts`
- `withSourceClaimVerdictCounts`
- `verdictTransitions` (for example `HOLD->CONDITIONAL_ALLOW`)

## Expected input shapes
### Gold map
JSON object keyed by `traceId` / `task_id`:
```json
{
  "trace-id": {
    "ground_truth": "...",
    "accepted_answers": ["optional alias 1", "optional alias 2"],
    "annotator_steps": ["...", "..."],
    "annotator_tools": ["Search engine", "Web browser"]
  }
}
```

### Source-claim map
JSON object keyed by `traceId`:
```json
{
  "trace-id": {
    "support": "exact",
    "confidence": "high",
    "exactStringQuestion": false
  }
}
```

### Profiles map
JSON object mapping profile label either to a gold-map path or to a per-profile config:
```json
{
  "coarse": "./tmp/coarse-gold.json",
  "medium": { "goldMap": "./tmp/medium-gold.json" },
  "fine": {
    "goldMap": "./tmp/fine-gold.json",
    "deriveSourceClaim": true
  },
  "fine-enriched": {
    "goldMap": "./tmp/fine-gold.json",
    "deriveSourceClaim": true,
    "enrichSourcePages": true
  }
}
```

Per-profile source-claim can either be supplied explicitly via `sourceClaimMap` or derived automatically via `deriveSourceClaim: true`.
Per-profile source-page enrichment is also available via `enrichSourcePages: true`, or globally via the top-level `--enrich-source-pages` flag.
The top-level `--source-claim-map` flag still works as a global fallback.

## Current methodological lesson
Reference-step granularity is not just a reporting detail.
Under the current local experiments, it can be the difference between:
- `ALLOW`
- and `retrieval HOLD -> CONDITIONAL_ALLOW`

So profile sweeps should be treated as part of the actual evaluation surface, not mere bookkeeping.

## Claim boundary
These workflows support reproducible local experiments.
They do not by themselves justify broad corpus-level claims.

Note: the current first-party enrichment path records `final_correct_method` in annotator metadata. Today this is still intentionally narrow, either `normalized_string_exact` or `normalized_string_exact_with_aliases` when `accepted_answers` are provided. It should not be mistaken for a general answer-equivalence verifier.
