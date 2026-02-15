# pot-cli v0.1

**ThoughtProof Proof-of-Thought CLI Tool** — Multi-model AI pipeline for robust, critic-reviewed answers.

## What is ThoughtProof?

ThoughtProof (PoT) is a protocol that combines multiple AI models in a structured pipeline:

1. **3 Generators** (diverse models) generate independent proposals
2. **Critic** (Red-Team) reviews all proposals for weaknesses
3. **Synthesizer** combines insights into a final, robust answer

Each run creates a **Block** — a JSON artifact containing all stages + metadata.

---

## Installation

```bash
cd pot-cli
npm install
npm run build
```

Make it globally available:

```bash
npm link
```

Now you can run `pot` from anywhere.

---

## Configuration

pot uses **BYOK** (Bring Your Own Keys). Set environment variables:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export XAI_API_KEY="xai-..."
export MOONSHOT_API_KEY="sk-..."
export OPENAI_API_KEY="sk-..."  # Optional
```

Or create `~/.potrc.json`:

```json
{
  "models": {
    "generator1": "grok-beta",
    "generator2": "moonshot-v1-8k",
    "generator3": "claude-sonnet-4-20250514",
    "critic": "claude-sonnet-4-20250514",
    "synthesizer": "claude-sonnet-4-20250514"
  },
  "blockStoragePath": "./blocks",
  "language": "de"
}
```

Check your config:

```bash
pot config
```

---

## Usage

### 1. Ask a question

```bash
pot ask "Should I invest in Bitcoin in 2026?"
```

This will:
- Run 3 generators in parallel
- Run critic review
- Synthesize final answer
- Save as `blocks/PoT-001.json`

Options:
- `--dry-run` — Test without calling APIs (fake responses)
- `--verbose` — Show detailed progress
- `--lang en` — Use English prompts (default: `de`)

Example:

```bash
pot ask "Ist KI eine Blase?" --verbose
```

### 2. List all blocks

```bash
pot list
```

Output:

```
📚 3 Blocks found:

PoT-001 │ 15.02.26, 21:30 │ Should I invest in Bitcoin? │ MDI: 0.67
PoT-002 │ 15.02.26, 22:15 │ Ist KI eine Blase? │ MDI: 0.65
PoT-003 │ 16.02.26, 09:00 │ Best strategy for... │ MDI: 0.70
```

### 3. Show a block

```bash
pot show 1
```

This displays:
- Question
- All 3 proposals
- Critique
- Final synthesis

### 4. Check configuration

```bash
pot config
```

Shows:
- Active models
- API key status (masked)
- Storage path
- Language

---

## Block Format

Each block is saved as JSON:

```json
{
  "id": "PoT-001",
  "version": "0.1.0",
  "timestamp": "2026-02-15T21:30:00Z",
  "question": "Should I invest in Bitcoin in 2026?",
  "normalized_question": "Should I invest in Bitcoin in 2026?",
  "proposals": [
    {"model": "grok-beta", "role": "generator", "content": "..."},
    {"model": "moonshot-v1-8k", "role": "generator", "content": "..."},
    {"model": "claude-sonnet-4", "role": "generator", "content": "..."}
  ],
  "critique": {"model": "claude-sonnet-4", "role": "critic", "content": "..."},
  "synthesis": {"model": "claude-sonnet-4", "role": "synthesizer", "content": "..."},
  "metadata": {
    "total_tokens": 12500,
    "total_cost_usd": 0.037,
    "duration_seconds": 8.3,
    "model_diversity_index": 0.67
  }
}
```

---

## Model Diversity Index (MDI)

MDI measures how diverse your model selection is:

```
MDI = 1 - Σ(fraction_i)²
```

- **MDI = 1.0** → All different models
- **MDI = 0.0** → All same model

Higher is better (more diverse perspectives).

---

## Development

```bash
npm run dev      # Watch mode
npm run build    # Production build
npm run test     # Dry-run test
```

---

## Roadmap

- [ ] Token/cost tracking from API responses
- [ ] Custom prompts via config
- [ ] Export to PDF/Markdown
- [ ] Interactive mode (`pot chat`)
- [ ] Support for more providers (Gemini, Mistral, ...)

---

## License

MIT

---

**Built with ❤️ for better AI reasoning.**
