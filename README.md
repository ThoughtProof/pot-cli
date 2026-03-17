<p align="center">
  <img src="docs/logo.jpg" alt="ThoughtProof" width="200">
</p>

# pot-cli — Proof of Thought

**Multi-model AI verification with adversarial critique.**

No AI can verify itself — so they verify each other.

[![npm version](https://img.shields.io/npm/v/pot-cli.svg)](https://www.npmjs.com/package/pot-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Patent Pending](https://img.shields.io/badge/Patent-Pending-blue.svg)](https://thoughtproof.ai)
[![Benchmark](https://img.shields.io/badge/vs_Majority_Vote-10:0-brightgreen.svg)](MAJORITY-VOTE-TEST.md)

## What is this?

pot-cli sends your question to multiple AI models from different providers, has them debate adversarially, and synthesizes a verified consensus. Think peer review for AI — not "ask 3 models and pick the best."

### Benchmark: PoT Pipeline vs Majority Vote — 10:0

In 10 controlled tests across factual, code, strategic, and compliance questions, the PoT pipeline caught fabricated statistics, hallucinated citations, and factual errors **in every single case**. Simple majority voting (asking the same models without adversarial critique) passed them all. [Full results →](MAJORITY-VOTE-TEST.md)

**Pipeline:**
```
Your Question → 4 Generators → Adversarial Critic → Synthesizer → Epistemic Block
                (different      (Red Team:           (consensus +
                 providers)      finds flaws)          disagreement score)
```

**Why?** Because asking GPT to verify GPT is like letting Moody's rate its own bonds — we saw how that ended in 2008. Independent verification exists because the verifier shouldn't have a stake in the outcome.

## Key Features

- 🔑 **BYOK (Bring Your Own Key):** Your API keys, your data, no middleman
- 🔀 **Model-neutral:** Works with any OpenAI-compatible endpoint + Anthropic
- ⚔️ **Adversarial by design:** Critic role actively searches for flaws
- 🔗 **Block chaining:** Outputs are hash-chained JSON documents (like git commits)
- 📊 **Disagreement scoring:** Model Diversity Index quantifies how much models disagree
- 🔄 **Deep mode:** 3 runs with rotated critic roles + meta-synthesis

## Quick Start

```bash
# Install
npm install -g pot-cli

# Configure (copy and edit with your API keys)
cp .potrc.json.example ~/.potrc.json

# Run a verification
pot-cli ask "Should a small business invest in AI automation?"

# Deep analysis (3 runs, rotated critics, meta-synthesis)
pot-cli deep "Is model-neutral verification a viable business?"

# List all blocks
pot-cli list

# Show a specific block
pot-cli show 42
```

## Configuration

Copy `.potrc.json.example` to `~/.potrc.json` and add your API keys:

```json
{
  "generators": [
    { "name": "xAI", "model": "grok-4-1-fast", "apiKey": "YOUR_KEY" },
    { "name": "Moonshot", "model": "kimi-k2.5", "apiKey": "YOUR_KEY" },
    { "name": "Anthropic", "model": "claude-sonnet-4-5-20250929", "provider": "anthropic", "apiKey": "YOUR_KEY" },
    { "name": "DeepSeek", "model": "deepseek-chat", "apiKey": "YOUR_KEY" }
  ],
  "critic": { "name": "Anthropic", "model": "claude-opus-4-6", "provider": "anthropic", "apiKey": "YOUR_KEY" },
  "synthesizer": { "name": "Anthropic", "model": "claude-opus-4-6", "provider": "anthropic", "apiKey": "YOUR_KEY" },
  "blockStoragePath": "./blocks",
  "language": "en"
}
```

**Supported providers:** Any OpenAI-compatible API (xAI, Moonshot, DeepSeek, OpenAI, Groq, Together, Ollama, etc.) + Anthropic native.

**Minimum:** 3 generators from different providers (model diversity requirement).

## How It Works

### Single Run (`pot-cli ask`)

1. **Normalize** — Standardize the question
2. **Generate** — 4 models propose answers independently (in parallel)
3. **Critique** — A different model plays Red Team, scoring and attacking each proposal
4. **Synthesize** — Final model combines strengths, addresses weaknesses, outputs confidence score

### Deep Analysis (`pot-cli deep`)

Runs the pipeline 3 times with **rotated critic roles:**
- Run 1: Generators A+B+C → Critic D
- Run 2: Generators D+B+C → Critic A  
- Run 3: Generators A+D+C → Critic B

Then a **meta-synthesis** combines all 3 runs into a final consensus.

This eliminates single-critic bias. Every model gets to be both proposer and critic.

### Epistemic Blocks

Each run produces a JSON block:

```json
{
  "id": "PoT-042",
  "question": "Is independent AI verification viable?",
  "proposals": [...],
  "critique": {...},
  "synthesis": {
    "content": "...",
    "model": "claude-opus-4-6"
  },
  "metadata": {
    "duration_seconds": 173,
    "model_diversity_index": 0.750
  }
}
```

Blocks are hash-chained and can reference previous blocks via `--context`.

## Benchmarks

Pipeline vs single-model across 6 controlled tests:

| Test | Pipeline | Solo | Winner |
|------|----------|------|--------|
| Market analysis | 4 | 1 | Pipeline |
| Defensibility | 4 | 1 | Pipeline |
| Architecture design | 5 | 1 | Pipeline |
| Protocol design | 4 | 2 | Pipeline |
| Benchmark design | 5 | 1 | Pipeline |
| Block format | 5 | 1 | Pipeline |
| **Total** | **27** | **7** | **Pipeline (3.9x)** |

Single models are creative but optimistic. The adversarial critic makes them honest.

## Code Review & Debugging

**This is a killer feature for developers.** Multiple AI models + static analysis review your code adversarially.

### `pot-cli debug` — Multi-model code debugging

```bash
# Debug a file — 4 LLMs + static analysis find bugs
pot-cli debug src/server.ts

# With error context
pot-cli debug src/auth.ts --error "TypeError: Cannot read property 'token' of undefined"

# Focus on specific lines (recommended for large files)
pot-cli debug src/server.ts --lines 50-120
```

> ⚠️ **Large files:** pot-cli sends your code to the configured APIs. For files >500 lines, use `--lines` to focus on the relevant section. This saves cost and improves accuracy.

**How it works:**
1. Static analysis runs instantly (ruff, mypy, shellcheck, eslint — depending on language)
2. 4 LLM generators analyze the code independently
3. Adversarial critic evaluates ALL proposals (including static analysis as anchor)
4. Synthesizer produces the best fix with explanation

**Why this beats single-model code review:**
- GPT might miss what Claude catches (and vice versa)
- Static analysis provides **deterministic ground truth** — LLMs can't gaslight the linter
- The critic checks if proposed fixes introduce NEW bugs
- You get a documented audit trail, not a chat message

Supports: Python, TypeScript, JavaScript, Go, Rust, Java, C/C++, Ruby, PHP, Swift, Kotlin, Bash.

### `pot-cli review` — Code review for PRs and files

```bash
# Review a file for quality, security, and best practices
pot-cli review src/api/routes.ts
```

Same adversarial pipeline, but focused on code quality rather than bug fixing.

### `pot-cli audit` — Compliance audit against frameworks

```bash
# Audit documents against DSGVO/GDPR
pot-cli audit ./privacy-policy/ --framework dsgvo

# Audit against SOC 2
pot-cli audit ./security-docs/ --framework soc2

# Audit against EU AI Act
pot-cli audit ./ai-system-docs/ --framework eu-ai-act
```

**Built-in frameworks:** GBA (German healthcare QM), DSGVO/GDPR, ISO 9001, HIPAA, SOC 2, EU AI Act.

4 AI models independently audit your documents, a critic checks if they missed anything, and you get a synthesized report with:
- Gap analysis (covered vs missing requirements)
- Compliance score (0-100%)
- Top 5 critical gaps with severity ratings
- Actionable recommendations
- Risk assessment

Works on single files or entire directories (reads up to 10 .md/.txt files).

### `pot-cli security-audit` — Static security analysis on any code repo

No LLM required. Pure pattern-matching with context-aware classification.

```bash
# Audit a GitHub repo (clones with --depth 1, no API key needed)
pot-cli security-audit https://github.com/strands-agents/tools

# Audit a local repo
pot-cli security-audit ./my-project

# Structured JSON output (pipe-friendly)
pot-cli security-audit ./my-project --json

# With TP-VC attestation (tamper-evident JSON certificate)
pot-cli security-audit https://github.com/owner/repo --tp-vc

# Verbose: show per-file progress
pot-cli security-audit ./my-project --verbose
```

**What it detects:**

| Pattern | CWE | Severity |
|---------|-----|----------|
| `exec()`, `eval()` (Python) | CWE-94 | Critical |
| `subprocess.Popen/run/call` | CWE-78 | Critical |
| `os.system/popen` | CWE-78 | Critical |
| `pickle.load/loads` | CWE-502 | Critical |
| `child_process.exec/spawn` (JS/TS) | CWE-78 | Critical |
| `new Function()` (JS/TS) | CWE-94 | Critical |
| `importlib.import_module` | CWE-829 | High |
| `yaml.load` without SafeLoader | CWE-502 | High |
| `vm.runInContext` | CWE-94 | High |

**Context-aware classification** — each finding is analyzed against ±20 lines of context to determine:

| Status | Meaning | CVSS |
|--------|---------|------|
| `unguarded` | No user consent mechanism | ~9.1 |
| `guarded-but-bypassable` | Guarded, but env var/flag can skip it | ~8.4 |
| `guarded` | Requires explicit user approval | ~5.5 |
| (sandbox present) | Runs inside container/jail/WASM/etc. | ~3.0 |

**Example output:**

```
🔍 Security Audit: strands-agents/tools (commit c98a7e96)

Found 3 findings in 47 files scanned:

[CRITICAL] src/strands_tools/python_repl.py:213
  exec(code, self._namespace)
  CWE-94 | CVSS ~8.4 | Status: guarded-but-bypassable
  Pattern: exec() — dynamic code execution
  Bypass: line 75 — BYPASS_TOOL_CONSENT
  Context: No sandbox keywords in ±20 lines
  Steel-man: User explicitly configures the tool and sets the bypass env var.
  🔗 https://github.com/strands-agents/tools/blob/c98a7e96/src/strands_tools/python_repl.py#L213

Summary: 2 Critical, 1 High, 0 Medium | 47 files scanned | 0.8s
Report saved: security-audit-strands-agents-tools-2026-02-26.md
```

**Limits:** Max 500 files, max 1 MB per file. Ignores `node_modules`, `.git`, `.venv`, `dist`, `build`, `__pycache__`.

**No API key needed.** This command is 100% local static analysis — no LLM calls.

## Commands

| Command | Description |
|---------|-------------|
| `pot-cli ask <question>` | Single verification run |
| `pot-cli deep <question>` | 3-run deep analysis with meta-synthesis |
| `pot-cli debug <file>` | Multi-model code debugging with static analysis |
| `pot-cli review <file>` | Adversarial code review |
| `pot-cli audit <target>` | Compliance audit (DSGVO, SOC 2, ISO 9001, …) |
| `pot-cli security-audit <target>` | Static security analysis — no LLM needed |
| `pot-cli list` | List all blocks |
| `pot-cli show <number>` | Display a specific block |
| `pot-cli config` | Show current configuration |

**Options (`ask`):**
- `--verbose` — Show progress details
- `--lang en|de` — Output language
- `--context last|all|5,8,9` — Chain with previous blocks
- `--dry-run` — Test without API calls
- `--verify-synthesis` — Run synthesis twice with different models and compare
- `--calibrate` — Run calibrated normalize step after synthesis (opt-in, costs one extra API call)

**Options (`security-audit`):**
- `--error "msg"` — Error context for debug mode
- `--json` — JSON output
- `--tp-vc` — TP-VC attestation
- `--critic` — DSPy-optimized adversarial critic

## Security & Privacy

**Your code, your keys, your control.**

- **No middleman:** pot-cli sends requests directly to the APIs you configure. We never see your code.
- **BYOK:** You choose which providers get your data. Trust only Anthropic? Use only Anthropic.
- **Local mode:** Point all generators at local models (Ollama, llama.cpp) for fully offline verification. Zero data leaves your machine.
- **No telemetry:** pot-cli collects nothing. No analytics, no usage tracking, no phone home.

⚠️ **For sensitive/proprietary code:** Use local models or review your providers' data retention policies. Code sent to cloud APIs is subject to each provider's terms of service.

```bash
# Example: fully local setup with Ollama
{
  "generators": [
    { "name": "Llama", "model": "llama3.1:70b", "baseUrl": "http://localhost:11434/v1/chat/completions", "apiKey": "ollama" },
    { "name": "Mistral", "model": "mistral-large", "baseUrl": "http://localhost:11434/v1/chat/completions", "apiKey": "ollama" },
    { "name": "DeepSeek", "model": "deepseek-coder-v2", "baseUrl": "http://localhost:11434/v1/chat/completions", "apiKey": "ollama" }
  ]
}
```

## Cost

You pay your own API costs (BYOK). Typical costs:

| Mode | Duration | Cost |
|------|----------|------|
| `ask` (single) | ~30-60s | $0.10-0.50 |
| `deep` (3 runs) | ~3-5 min | $0.50-2.00 |

Best for high-stakes decisions where being wrong is expensive. Overkill for "What's the capital of France?"

## Limitations

- **Not a chatbot.** It's a verification protocol.
- **Not cheap.** Multi-model means multi-cost.
- **Not magic.** All models can be wrong about the same thing (unknown unknowns).
- **61 blocks is promising data, not proof.** More testing needed.
- **TypeScript/Node.js.** Python port welcome (PRs appreciated).

## License

MIT — do whatever you want with it.

## Patent

Patent pending: USPTO #63/984,669. Not to gatekeep — to protect the protocol from being swallowed by a single provider. The code is and will remain MIT.

## Examples

See the [`examples/`](examples/) folder for full output samples:

- [Debug output](examples/example-debug-output.md) — Finding an async/await race condition
- [Audit output](examples/example-audit-output.md) — SOC 2 compliance audit (score: 61/100)
- [Ask output](examples/example-ask-output.md) — Microservices vs Monolith (4/4 consensus)

## Links

- **Website:** [thoughtproof.ai](https://thoughtproof.ai)
- **Docs:** [thoughtproof.ai/docs](https://thoughtproof.ai/docs)
- **Demo:** [thoughtproof.ai/demo](https://thoughtproof.ai/demo)

---

*"No AI should verify itself — just as no surgeon operates without a second opinion."*

**ThoughtProof™ — AI verification owned by no one, trusted by everyone.**
