# Tier-1 Pre-Filter mit Ollama (lokal)

Anleitung für den lokalen Tier-1-Backend-Modus über [Ollama](https://ollama.com).
Empfohlen für Apple Silicon (M-Serie, ≥16 GB unified memory) — null API-Kosten,
kompletter Run lokal.

## Architektur — kurz

PLV Graded Support nutzt zwei Tiers:

- **Tier 1** (schnell, billig): Binärer "supported / nicht supported"-Check pro
  (plan_step, trace)-Paar. Bei `confidence ≥ 0.80` → `tier1_supported`, bei
  `≤ 0.20` → `tier1_unsupported`, dazwischen → Tier 2.
- **Tier 2** (teuer, präzise): Voller LLM-Evaluator (Grok / Gemini / DeepSeek)
  mit dem `GRADED_SUPPORT_SYSTEM_PROMPT` inkl. R1–R7 + D-06.

Erwartung: ~75 % der Steps in Tier 1 abgehandelt → ~4× Kosten-Reduktion bei
gleicher Verdict-Stabilität (D-06 bleibt unangetastet, Tier 2 läuft für alle
ambiguen Fälle).

## Setup auf dem M4 (Hermes)

```bash
# 1) Ollama installieren (falls noch nicht)
brew install ollama

# 2) Daemon starten (läuft im Hintergrund, lauscht auf 127.0.0.1:11434)
ollama serve &

# 3) Modell ziehen (~5 GB, Q4-quantisiert, M4 16GB-freundlich)
ollama pull qwen2.5:7b

# 4) Smoke-Test — JSON-Mode prüfen
curl -s http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b",
  "prompt": "Reply with JSON only: {\"ok\": true}",
  "stream": false,
  "format": "json"
}' | jq .response
# Erwartet: "{\"ok\": true}"
```

## Repo bauen + Branch checkout

```bash
git fetch origin
git checkout feat/plv-ollama-tier1
npm install
rm -rf dist && npm run build
npm run test:plan          # 197/197 grün, davon 16 OllamaBackend mock-tests
```

## Benchmark-Run gegen die 40 Cases

```bash
# Multi-Model-Cascade mit Tier-1 = Ollama (qwen2.5:7b)
node dist/index.js plan-graded-eval \
  --input cases/plv-new-40-cases-2026-04-26.json \
  --model grok \
  --tier1 ollama \
  --ollama-model qwen2.5:7b \
  --output runs/plv-tier1-ollama-grok.json

# Wiederholen mit gemini, deepseek (gleiche Cases, gleiche Tier-1-Resolutions)
node dist/index.js plan-graded-eval \
  --input cases/plv-new-40-cases-2026-04-26.json \
  --model gemini \
  --tier1 ollama \
  --output runs/plv-tier1-ollama-gemini.json

node dist/index.js plan-graded-eval \
  --input cases/plv-new-40-cases-2026-04-26.json \
  --model deepseek \
  --tier1 ollama \
  --output runs/plv-tier1-ollama-deepseek.json
```

## Optionale Flags

| Flag              | Default                   | Zweck                                              |
|-------------------|---------------------------|----------------------------------------------------|
| `--tier1`         | _disabled_                | Backend-Wahl: `llm` / `minicheck` / `hf-inference` / `ollama` |
| `--ollama-url`    | `http://localhost:11434`  | Daemon-Endpoint (z. B. Remote-M4 im LAN)           |
| `--ollama-model`  | `qwen2.5:7b`              | Modell-Tag (alternativ: `llama3.2:3b`, `mistral:7b`) |
| `--t-low`         | `0.20`                    | Schwelle für "confident unsupported"               |
| `--t-high`        | `0.80`                    | Schwelle für "confident supported"                 |

## Akzeptanzkriterien für den Benchmark

Vergleich `--tier1 ollama` vs. `--tier1` weggelassen (alles Tier 2) auf den
gleichen 40 Cases, gleichem Tier-2-Modell:

- **Verdict-Parität (hart)**: 0 BLOCK→ALLOW oder HOLD→ALLOW Regressionen
- **Verdict-Parität (weich)**: ≥ 95 % identische Verdicts, alle Diffs in
  CONDITIONAL-Zone akzeptabel
- **Tier-1-Resolve-Rate**: ≥ 70 % der Steps in Tier 1 entschieden
- **Latenz pro Step (Tier 1, M4)**: ≤ 2 s im Median
- **D-06**: 100 % der wrong-source-Cases bleiben BLOCK (zero tolerance)

## Troubleshooting

- **`ECONNREFUSED`**: Daemon nicht gestartet — `ollama serve &`
- **`model not found`**: `ollama pull qwen2.5:7b`
- **Alle Steps gehen in Tier 2 (avgConfidence ≈ 0.5)**: JSON-Mode-Output
  prüfen mit dem Smoke-Test oben. Falls qwen2.5:7b kein valides JSON liefert,
  Modell wechseln (`--ollama-model llama3.2:3b`).
- **OOM auf 16 GB-Mac**: Auf 3B-Modell wechseln (`--ollama-model llama3.2:3b`)
  oder andere Apps schließen.

## Code-Pfad

- Backend: `src/plan/tier1-prefilter.ts` → `OllamaBackend`
- Factory: `createBackend` (case `'ollama'`)
- CLI: `src/commands/plan-graded-eval.ts` (Flags `--tier1 ollama`,
  `--ollama-url`, `--ollama-model`)
- Tests (mocked): `src/plan/test-ollama-backend.ts` (16 tests)
