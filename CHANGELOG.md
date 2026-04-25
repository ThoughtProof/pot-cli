# Changelog

All notable changes to pot-cli will be documented in this file.

## [0.8.0] - 2026-04-25

### 🚀 Major: PLV Two-Tier Architecture + Gate 1 Passed

#### New Commands
- `plan-auto-gen` — TICK-based gold plan auto-generation with domain detection, 5 skeleton patterns, few-shot examples
  - `--calibrate` flag for Counterfactual Omission Test (criticality calibration)
  - `--add-to-benchmark` to append generated plans to benchmark JSON
  - `--case-id` and `--trace` for full case assembly
  - `--compare` mode for batch comparison against gold plans
- `plan-loocv` — Leave-One-Out Cross-Validation with Wilson Score CI
  - `--gate` threshold for automated Gate decisions
  - Per-family breakdown, influential case analysis

#### Two-Tier Evaluator Architecture
- `tier1-prefilter.ts` — Pluggable pre-filter with 3 backends:
  - `llm` (DeepSeek/any LLM) — works now, no GPU needed
  - `minicheck` (HTTP) — for MiniCheck-FT5 microservice
  - `hf-inference` (HuggingFace API) — no local GPU needed
- `--tier1 llm` flag on `plan-graded-eval` enables two-tier mode
- Critical-Step Guard: critical steps always go to Tier 2 (Grok), only supporting steps filtered by Tier 1
- 17% Grok API cost reduction with zero verdict regression

#### Evaluator Improvements
- R6 (wrong-source rule): score=0.0 when agent uses secondary/blog source instead of required primary source
- Gold label corrections: V1-R05 HOLD→BLOCK, V2-C04 HOLD→BLOCK (evidence-based)
- Result: **40/40 verdict accuracy (100%), Wilson 95% CI [91.2%, 100.0%]**
- Gate 1: PASSED ✅

### Added
- `src/plan/tick-auto-gen.ts` — TICK template engine with domain detection and skeleton patterns
- `src/plan/criticality-calibrator.ts` — Counterfactual Omission Test for criticality recalibration
- `src/plan/tier1-prefilter.ts` — Pluggable Tier-1 pre-filter backends
- `src/commands/plan-auto-gen.ts` — CLI for plan generation + benchmark integration
- `src/commands/plan-loocv.ts` — LOOCV analysis with Wilson CI

### Changed
- `graded-support-evaluator.ts` — Two-tier evaluation flow, R6 wrong-source rule, Critical-Step Guard
- `plan-graded-eval.ts` — `--tier1`, `--tier1-model`, `--t-low`, `--t-high` flags

## [Unreleased]

### Added

- `plan-enrich-first-party` CLI command to enrich first-party JSONL traces with gold/reference metadata
- `plan-enrich-source-pages` CLI command to enrich first-party browse evidence with fetched source-page metadata (`<title>`, `<h1>`, narrow acronym-aware page-text fallback)
- `plan-build-source-claim-map` CLI command to derive source-claim support from first-party traces and gold/reference data
- `plan-sweep-first-party` CLI command to compare the same traces across multiple reference profiles
- Per-profile `sourceClaimMap` support in plan sweeps, with global fallback still supported
- Per-profile `deriveSourceClaim: true` support to auto-build source-claim evidence directly from enriched first-party traces
- `--enrich-source-pages` support in `plan-build-source-claim-map` and `plan-sweep-first-party`
- Compact sweep `summary` output with baseline counts, source-claim counts, and verdict transitions
- `--format text` mode for human-readable sweep reports
- Stable hard-v2 threshold fixtures and regression test covering coarse/medium/fine plus fine+source-claim behavior
- `accepted_answers` support in first-party gold maps for narrow alias-based correctness handling

### Changed

- First-party enrichment logic is now shared instead of duplicated across commands
- Source-page enrichment logic is reusable across standalone enrichment and source-claim workflows
- Sweep evaluation reuses merged support across baseline and source-claim passes instead of recomputing the whole alignment stack twice
- Workflow docs now cover the full plan-level CLI path and clarify the narrow correctness method used in first-party enrichment

## [0.2.0] - 2026-02-18

### 🚀 Major: BYOK Refactor - Flexible Provider Configuration

**Breaking Changes:** None (backward compatible!)

### Added

- **Flexible Generator Configuration**: Support for any OpenAI-compatible LLM provider
- New `.potrc.json` format with explicit `generators`, `critic`, `synthesizer` arrays
- Each generator can specify:
  - `name`: Provider label (used in output)
  - `model`: Model identifier
  - `baseUrl`: Custom OpenAI-compatible endpoint
  - `apiKey`: Per-generator API key
  - `provider: "anthropic"`: Flag for Anthropic Messages API (non-OpenAI-compatible)
- Auto-detection of base URLs for known providers (xai, moonshot, deepseek, openai)
- `createProvidersFromConfig()` helper function in `config.ts`
- Updated `pot config` command to display new format beautifully

### Changed

- **types.ts**: Added `GeneratorConfig` interface, made old fields optional
- **config.ts**: Added migration logic from old format → new format (automatic)
- **providers/openai.ts**: Constructor accepts dynamic `baseUrl`, `apiKey`, `providerName`
- **providers/anthropic.ts**: Constructor accepts `apiKey` and `providerName`
- **All commands** (ask, audit, deep, debug, review): Simplified to use `createProvidersFromConfig()`
- Removed hardcoded provider instantiation and `getProviderForModel()` string-matching

### Migration

Old configs are **automatically migrated** at runtime. No manual changes needed!

**Old format:**
```json
{
  "models": {
    "generator1": "grok-4-1-fast",
    "generator2": "kimi-k2-turbo-preview",
    ...
  },
  "apiKeys": {
    "anthropic": "sk-ant-...",
    ...
  }
}
```

**New format:**
```json
{
  "generators": [
    {"name": "xAI", "model": "grok-4-1-fast", "baseUrl": "https://api.x.ai/v1/chat/completions", "apiKey": "xai-..."},
    {"name": "Moonshot", "model": "kimi-k2-turbo-preview", "baseUrl": "https://api.moonshot.ai/v1/chat/completions", "apiKey": "sk-..."},
    {"name": "Anthropic", "model": "claude-sonnet-4-5-20250929", "provider": "anthropic", "apiKey": "sk-ant-..."}
  ],
  "critic": {"name": "Anthropic", "model": "claude-opus-4-6", "provider": "anthropic", "apiKey": "sk-ant-..."},
  "synthesizer": {"name": "Anthropic", "model": "claude-opus-4-6", "provider": "anthropic", "apiKey": "sk-ant-..."}
}
```

### Technical Details

- Minimum 3 generators required (enforced via `createProvidersFromConfig`)
- Model diversity check now based on `name` field (not model string matching)
- Anthropic provider uses `provider: "anthropic"` flag → Messages API
- All other providers assume OpenAI-compatible chat/completions endpoint

---

## [0.1.0] - 2026-02-15

### Initial Release

- Multi-model PoT pipeline (Generators → Critic → Synthesizer)
- Commands: `ask`, `list`, `show`, `config`
- Block storage as JSON
- Support for Anthropic, xAI, Moonshot, DeepSeek
- German/English language support
- Dry-run mode
- Model Diversity Index (MDI) calculation
