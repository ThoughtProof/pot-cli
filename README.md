# pot-cli — Proof of Thought

**Multi-model AI verification with adversarial critique.**

No AI can verify itself — so they verify each other.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Patent Pending](https://img.shields.io/badge/Patent-Pending-blue.svg)](https://thoughtproof.ai)

## What is this?

pot-cli sends your question to multiple AI models from different providers, has them debate adversarially, and synthesizes a verified consensus. Think peer review for AI — not "ask 3 models and pick the best."

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

## Commands

| Command | Description |
|---------|-------------|
| `pot-cli ask <question>` | Single verification run |
| `pot-cli deep <question>` | 3-run deep analysis with meta-synthesis |
| `pot-cli list` | List all blocks |
| `pot-cli show <number>` | Display a specific block |
| `pot-cli config` | Show current configuration |
| `pot-cli audit` | Audit block integrity |

**Options:**
- `--verbose` — Show progress details
- `--lang en|de` — Output language
- `--context last|all|5,8,9` — Chain with previous blocks
- `--dry-run` — Test without API calls

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

## Links

- **Website:** [thoughtproof.ai](https://thoughtproof.ai)
- **Docs:** [thoughtproof.ai/docs](https://thoughtproof.ai/docs)
- **Demo:** [thoughtproof.ai/demo](https://thoughtproof.ai/demo)

---

*"No AI should verify itself — just as no surgeon operates without a second opinion."*

**ThoughtProof™ — AI verification owned by no one, trusted by everyone.**
