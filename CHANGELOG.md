# Changelog

All notable changes to pot-cli will be documented in this file.

## [0.8.3] - 2026-04-26

### 🔧 PLV: Provenance Matcher — Mode 1 + Mode 3 Fix

Addresses two distinct quote-matching failure modes in the plan-level
verifier without loosening any existing rejection rules. Net-0 verdict
shift on 82-case A/B run, with 3 genuine fixes (CODE-05, GAIA-16, H-08)
balanced by 3 LLM-drift cases (CODE-02, ENV-02, H-06) confirmed via
audit-trail to be provider non-determinism, not matcher behavior.

#### Added
- `normalizeUnicodeForMatch()` in `graded-support-evaluator.ts` — NFKC
  normalization plus ASCII-fold for smart quotes, en/em-dashes,
  ellipsis character, and zero-width characters. Does NOT touch letters,
  digits, casing, or word order.
- `stripWrappingQuotes()` in `graded-support-evaluator.ts` — conservative
  unwrap of one outer layer of paired quote characters.
- Two new match paths in `verifyProvenance()`, both gated behind
  `PLV_DISABLE_NEW_MATCH_PATHS=1` env toggle for A/B comparison:
  - `unicode-normalized` (Mode 1: tokenization)
  - `structural-unwrapped` (Mode 3: structural meta-quote)
- `src/scripts/provenance-sweep.ts` — synthetic-probe sweep over 40
  cases × 8 quote variants. `--full` mode runs verdict-level A/B via
  `evaluateBatch` with the env toggle.
- `src/scripts/sweep-toggle-smoketest.ts` — 4 probes verifying the
  toggle mechanism (4/4 pass).
- `src/plan/test-provenance-diagnostics.ts` (TDD bed from #4) — 8 RED
  tests now GREEN. Total: 181/181 passing.
- `docs/design/mode2-paraphrase-design-skizze-2026-04-26.md` —
  trade-off analysis for why Mode 2 (paraphrase) and Mode 4
  (wrong-source) are rejected by design. Documents the kill-shot
  side-effect on D-06 wrong-source detection that any paraphrase
  tolerance would trigger.

#### Changed
- README `## Limitations` now points to the Mode 2 design doc.
- `src/plan/test-provenance-diagnostics.ts` — em-dash test spacing
  aligned with trace spacing (avoids accidental paraphrase-tolerance
  via whitespace).

#### Hard Rules — explicitly preserved
- D-06 wrong-source (R6 floor) lock holds.
- CODE-05 step_3 paraphrase rejection lock holds.
- Mode 2 (paraphrase) and Mode 4 (wrong-source) match paths unchanged.
- Sample SHA256 `92ec87e4...` (40 cases: 19 BLOCK / 6 HOLD / 15 ALLOW)
  after gold corrections D-08, MED-03, FIN-04 → BLOCK.

Merged via PRs #5 (`a3ff0be`) and #6 (`d390167`).

## [0.8.1] - 2026-04-25

### Added
- `src/verdict-mapper.ts` — Maps internal 5-tier engine verdicts (ALLOW/CONDITIONAL_ALLOW/HOLD/DISSENT/BLOCK) to public 3-tier API contract (ALLOW/BLOCK/UNCERTAIN)
- `src/__tests__/verdict-mapper.test.ts` — 15 tests with anti-leak regression guard
- `--format public|internal` flag on `plan-graded-eval` CLI command
- `metadata.schema_version: 'v2'` on every public API response
- `THOUGHTPROOF_INTERNAL=1` env guard for internal format output
- Exhaustive TypeScript switch with `never` compile-time safety

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
