# Plan-Level v0 Runner Spec

_Date: 2026-04-23_
_Status: minimal implementation spec_

## Purpose
This file defines the smallest durable runner surface for the current v2 internal benchmark bundle:

- `tmp/benchmark-v0-plan-level-2026-04-23.jsonl`

The goal is to replace lost session glue with a repo-native scoring path.

## Confirmed policy state
Current `src/plan/policy.ts` already contains the narrow softening patch:
- `evaluateFallbackPolicy(...)` now allows `HOLD -> CONDITIONAL_ALLOW` via `qualifiesForNarrowSupportSoftening(...)`
- `evaluateMixedPolicy(...)` now allows `HOLD -> CONDITIONAL_ALLOW` via the same gate

This means the next missing piece is not policy shape, but benchmark execution.

## Proposed command surface
Add a first-class CLI command:

```bash
node dist/index.js plan-score-benchmark <bundle.jsonl>
```

Suggested implementation path:
- command: `src/commands/plan-score-benchmark.ts`
- helper logic: `src/plan/benchmark-runner.ts`

## Input
The command consumes the normalized benchmark JSONL bundle.

Each record already includes:
- `id`
- `candidateObjectType`
- `candidateObjectRef`
- `expectedVerdict`
- `referenceSteps`
- `criticalSteps`
- `sourceArtifacts`
- `notes`

## v0 item classes
Current bundle mixes three item types:

1. `trace`
2. `decision_memo`
3. `plan`

This means the runner must support mixed execution honestly instead of pretending the bundle is a plain first-party trace sweep.

## Minimal scoring contract
For each item, produce:
- `id`
- `candidateObjectType`
- `expectedVerdict`
- `actualVerdict`
- `status` = `exact_match | conservative_miss | dangerous_miss | manual_gap`
- `reason`

Bundle summary should report:
- total item count
- scored item count
- manual gap count
- exact match count
- conservative miss count
- dangerous miss count
- exact-match percentage on scored items

## v0 execution policy
### Phase 1 (minimum durable version)
Automate what is already well-grounded and mark the rest explicitly.

#### `trace` items
For trace-backed items, the runner should:
1. resolve the referenced trace / artifact family
2. load the relevant gold/source-claim context from existing fixture paths when available
3. run the nearest existing plan-level evaluation path
4. extract the resulting verdict

If a trace item cannot be resolved deterministically, mark it as:
- `manual_gap`

#### `decision_memo` items
Do not fake automation in v0.
If no existing deterministic evaluator exists, score as:
- `manual_gap`

#### `plan` items
Do not fake automation in v0.
If no existing deterministic evaluator exists, score as:
- `manual_gap`

This is acceptable for the first durable runner as long as the report is explicit.

## Status classification rules
### `exact_match`
`actualVerdict === expectedVerdict`

### `conservative_miss`
Expected softer than actual, for example:
- expected `CONDITIONAL_ALLOW`, actual `HOLD`
- expected `HOLD`, actual `BLOCK`

### `dangerous_miss`
Actual looser than expected, for example:
- expected `BLOCK`, actual `HOLD`
- expected `HOLD`, actual `CONDITIONAL_ALLOW`
- expected `CONDITIONAL_ALLOW`, actual `ALLOW`

### `manual_gap`
Used only when the item cannot yet be scored reproducibly by the repo.

## Minimal output formats
### Text
Human-readable report with one line per item plus summary.

### JSON
Machine-readable object:
- `bundlePath`
- `runDate`
- `summary`
- `items`

## Immediate value
Even a partial first implementation is already useful if it:
- scores all currently resolvable trace-backed items
- reports unresolved items honestly
- gives a stable read on whether `V0-01` / `V0-02` improve
- preserves visibility into dangerous misses

## First validation target
Use the existing v0 bundle and verify at minimum:
- whether `V0-01` changes from `HOLD` to `CONDITIONAL_ALLOW`
- whether `V0-02` changes from `HOLD` to `CONDITIONAL_ALLOW`
- whether `BLOCK` items remain stable

## Bottom line
The correct next implementation is not a broad benchmark framework.
It is a narrow, honest `plan-score-benchmark` command that turns the current v0 JSONL bundle into a reproducible scored artifact.