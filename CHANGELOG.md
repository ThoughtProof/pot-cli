# Changelog

All notable changes to pot-cli will be documented in this file.

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
