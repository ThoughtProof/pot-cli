/**
 * Tier-1 Pre-Filter for PLV Graded Support Evaluator
 * ====================================================
 * Fast, cheap binary screening of (plan_step, trace_excerpt) pairs.
 * Confident results skip the expensive Tier-2 LLM evaluator.
 *
 * Architecture: Pluggable backends
 *   - LLMBinaryBackend: Uses a cheap LLM (DeepSeek, etc.) with focused binary prompt
 *   - MiniCheckBackend: HTTP call to local MiniCheck-FT5 service (when available)
 *   - HFInferenceBackend: HuggingFace Inference API (no local GPU needed)
 *   - OllamaBackend: Local Ollama daemon (zero API cost, runs on Apple Silicon / consumer GPU)
 *
 * Research basis: Perplexity Mission 4 (2026-04-25)
 *   - MiniCheck-FT5: 75.0% BAcc ≈ GPT-4 (75.3%) at 166× cheaper
 *   - Two-tier routing: raw_prob < 0.20 → unsupported, > 0.80 → supported
 *   - Expected: ~75% of steps resolved in Tier 1
 */

import { callModel, type ChatMessage } from '../utils/model-router.js';
import { DEFAULT_EVAL_SEED } from './graded-support-evaluator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tier1Result {
  stepId: string;
  stepDescription: string;
  supported: boolean;
  confidence: number;      // 0.0–1.0
  routing: 'tier1_supported' | 'tier1_unsupported' | 'tier2_required';
  backendUsed: string;
  latencyMs: number;
}

export interface Tier1Config {
  backend: 'llm' | 'minicheck' | 'hf-inference' | 'ollama';
  model?: string;                // LLM backend: model alias (default: 'deepseek')
  tLow?: number;                 // below → confidently unsupported (default: 0.20)
  tHigh?: number;                // above → confidently supported (default: 0.80)
  minicheckUrl?: string;         // MiniCheck backend: HTTP endpoint
  hfModel?: string;              // HF backend: model ID
  hfToken?: string;              // HF backend: API token
  ollamaUrl?: string;            // Ollama backend: HTTP endpoint (default: http://localhost:11434)
  ollamaModel?: string;          // Ollama backend: model tag (default: qwen2.5:7b)
  enabled?: boolean;             // false → skip Tier 1 entirely (default: true)
}

export interface Tier1Backend {
  name: string;
  scoreStep(stepDescription: string, traceExcerpt: string): Promise<{ supported: boolean; confidence: number }>;
  scoreBatch(pairs: Array<{ stepId: string; step: string; trace: string }>): Promise<Array<{ stepId: string; supported: boolean; confidence: number }>>;
}

export interface Tier1BatchResult {
  results: Tier1Result[];
  stats: {
    total: number;
    tier1Resolved: number;
    tier2Required: number;
    avgConfidence: number;
    totalLatencyMs: number;
  };
}

// ─── LLM Binary Backend ──────────────────────────────────────────────────────

const BINARY_SUPPORT_PROMPT = `You are a fast factual support classifier.
Given a CLAIM and a DOCUMENT, determine if the document provides sufficient evidence for the claim.

Rules:
- Answer ONLY with a JSON object: {"supported": true/false, "confidence": 0.0-1.0}
- confidence near 1.0 = very confident the claim IS supported by evidence
- confidence near 0.0 = very confident the claim is NOT supported
- confidence near 0.5 = ambiguous / insufficient evidence to decide
- Do NOT explain. ONLY JSON.

DOCUMENT:
{document}

CLAIM:
{claim}

JSON:`;

export class LLMBinaryBackend implements Tier1Backend {
  name = 'llm-binary';
  private model: string;

  constructor(model: string = 'deepseek') {
    this.model = model;
    this.name = `llm-binary:${model}`;
  }

  async scoreStep(stepDescription: string, traceExcerpt: string): Promise<{ supported: boolean; confidence: number }> {
    const prompt = BINARY_SUPPORT_PROMPT
      .replace('{document}', traceExcerpt.slice(0, 4000))  // Cap trace length for cost
      .replace('{claim}', stepDescription);

    const messages: ChatMessage[] = [
      { role: 'user', content: prompt },
    ];

    try {
      const response = await callModel(this.model, messages, {
        maxTokens: 64,
        temperature: 0,
        seed: DEFAULT_EVAL_SEED,
      });

      const match = response.content.match(/\{[\s\S]*?\}/);
      if (!match) return { supported: false, confidence: 0.5 };  // Ambiguous on parse failure

      const parsed = JSON.parse(match[0]) as { supported?: boolean; confidence?: number };
      return {
        supported: parsed.supported === true,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      };
    } catch {
      // On error, route to Tier 2 (confidence = 0.5 = ambiguous)
      return { supported: false, confidence: 0.5 };
    }
  }

  async scoreBatch(pairs: Array<{ stepId: string; step: string; trace: string }>): Promise<Array<{ stepId: string; supported: boolean; confidence: number }>> {
    // Sequential for now — LLM APIs are rate-limited anyway
    // Could parallelize with concurrency limit later
    const results: Array<{ stepId: string; supported: boolean; confidence: number }> = [];

    for (const pair of pairs) {
      const result = await this.scoreStep(pair.step, pair.trace);
      results.push({ stepId: pair.stepId, ...result });
    }

    return results;
  }
}

// ─── MiniCheck HTTP Backend ──────────────────────────────────────────────────

export class MiniCheckBackend implements Tier1Backend {
  name = 'minicheck-ft5';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8501') {
    this.baseUrl = baseUrl;
  }

  async scoreStep(stepDescription: string, traceExcerpt: string): Promise<{ supported: boolean; confidence: number }> {
    const res = await fetch(`${this.baseUrl}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim: stepDescription, document: traceExcerpt }),
    });

    if (!res.ok) throw new Error(`MiniCheck ${res.status}: ${await res.text()}`);

    const data = await res.json() as { supported: boolean; confidence: number };
    return data;
  }

  async scoreBatch(pairs: Array<{ stepId: string; step: string; trace: string }>): Promise<Array<{ stepId: string; supported: boolean; confidence: number }>> {
    const res = await fetch(`${this.baseUrl}/score/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: pairs.map(p => ({ claim: p.step, document: p.trace })),
      }),
    });

    if (!res.ok) throw new Error(`MiniCheck batch ${res.status}: ${await res.text()}`);

    const data = await res.json() as Array<{ supported: boolean; confidence: number }>;
    return data.map((d, i) => ({ stepId: pairs[i].stepId, ...d }));
  }
}

// ─── HuggingFace Inference API Backend ────────────────────────────────────────

export class HFInferenceBackend implements Tier1Backend {
  name = 'hf-inference';
  private modelId: string;
  private token: string;

  constructor(modelId: string = 'lytang/MiniCheck-Flan-T5-Large', token?: string) {
    this.modelId = modelId;
    this.token = token ?? process.env.HF_TOKEN ?? '';
    this.name = `hf:${modelId.split('/').pop()}`;
  }

  async scoreStep(stepDescription: string, traceExcerpt: string): Promise<{ supported: boolean; confidence: number }> {
    // HF Inference API for text-classification or text2text-generation
    const res = await fetch(`https://api-inference.huggingface.co/models/${this.modelId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        inputs: `Document: ${traceExcerpt.slice(0, 4000)}\nClaim: ${stepDescription}`,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HF Inference ${res.status}: ${err.slice(0, 200)}`);
    }

    // Parse response — format depends on model type
    const data = await res.json() as any;
    // For text2text-generation models (Flan-T5):
    if (Array.isArray(data) && data[0]?.generated_text) {
      const text = data[0].generated_text.toLowerCase();
      const isYes = text.includes('yes') || text.includes('true') || text.includes('supported');
      return { supported: isYes, confidence: isYes ? 0.75 : 0.25 };
    }
    // For classification models:
    if (Array.isArray(data) && data[0]?.[0]?.label) {
      const labels = data[0] as Array<{ label: string; score: number }>;
      const entailment = labels.find(l => l.label.toLowerCase().includes('entail'));
      return {
        supported: entailment ? entailment.score > 0.5 : false,
        confidence: entailment?.score ?? 0.5,
      };
    }

    return { supported: false, confidence: 0.5 };
  }

  async scoreBatch(pairs: Array<{ stepId: string; step: string; trace: string }>): Promise<Array<{ stepId: string; supported: boolean; confidence: number }>> {
    // HF Inference API doesn't support native batching for all models
    const results: Array<{ stepId: string; supported: boolean; confidence: number }> = [];
    for (const pair of pairs) {
      const result = await this.scoreStep(pair.step, pair.trace);
      results.push({ stepId: pair.stepId, ...result });
    }
    return results;
  }
}

// ─── Ollama Local Backend ────────────────────────────────────────────────────
//
// Calls a locally running Ollama daemon (https://ollama.com) via the
// /api/generate endpoint with JSON mode. Reuses BINARY_SUPPORT_PROMPT for
// parity with LLMBinaryBackend, so confidence semantics line up across
// backends. Designed for Apple Silicon (M-series) — qwen2.5:7b Q4 is the
// default, fits comfortably in 16 GB unified memory.

interface OllamaGenerateResponse {
  response: string;
  done?: boolean;
  error?: string;
}

export class OllamaBackend implements Tier1Backend {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'qwen2.5:7b',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.name = `ollama:${model}`;
  }

  async scoreStep(stepDescription: string, traceExcerpt: string): Promise<{ supported: boolean; confidence: number }> {
    const prompt = BINARY_SUPPORT_PROMPT
      .replace('{document}', traceExcerpt.slice(0, 4000))
      .replace('{claim}', stepDescription);

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0,
            num_predict: 64,
          },
        }),
      });

      if (!res.ok) {
        // Ambiguous → Tier 2 takes over
        return { supported: false, confidence: 0.5 };
      }

      const data = await res.json() as OllamaGenerateResponse;
      if (data.error || typeof data.response !== 'string') {
        return { supported: false, confidence: 0.5 };
      }

      // Ollama in JSON-mode returns the JSON object as a string in `response`.
      const match = data.response.match(/\{[\s\S]*?\}/);
      if (!match) return { supported: false, confidence: 0.5 };

      const parsed = JSON.parse(match[0]) as { supported?: boolean; confidence?: number };
      return {
        supported: parsed.supported === true,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      };
    } catch {
      // Network error / daemon offline / malformed JSON → route to Tier 2
      return { supported: false, confidence: 0.5 };
    }
  }

  async scoreBatch(pairs: Array<{ stepId: string; step: string; trace: string }>): Promise<Array<{ stepId: string; supported: boolean; confidence: number }>> {
    // Sequential — local single-model daemon, parallelism wouldn't help and
    // could OOM the GPU on consumer hardware.
    const results: Array<{ stepId: string; supported: boolean; confidence: number }> = [];
    for (const pair of pairs) {
      const result = await this.scoreStep(pair.step, pair.trace);
      results.push({ stepId: pair.stepId, ...result });
    }
    return results;
  }
}

// ─── Tier-1 Router ────────────────────────────────────────────────────────────

export function createBackend(config: Tier1Config): Tier1Backend {
  switch (config.backend) {
    case 'llm':
      return new LLMBinaryBackend(config.model ?? 'deepseek');
    case 'minicheck':
      return new MiniCheckBackend(config.minicheckUrl ?? 'http://localhost:8501');
    case 'hf-inference':
      return new HFInferenceBackend(config.hfModel, config.hfToken);
    case 'ollama':
      return new OllamaBackend(
        config.ollamaUrl ?? 'http://localhost:11434',
        config.ollamaModel ?? 'qwen2.5:7b',
      );
    default:
      throw new Error(`Unknown Tier-1 backend: ${(config as { backend: string }).backend}`);
  }
}

export async function tier1PreScreen(
  traceExcerpt: string,
  steps: Array<{ stepId: string; description: string; criticality: string }>,
  config: Tier1Config,
): Promise<Tier1BatchResult> {
  if (config.enabled === false) {
    // Tier 1 disabled → all steps go to Tier 2
    return {
      results: steps.map(s => ({
        stepId: s.stepId,
        stepDescription: s.description,
        supported: false,
        confidence: 0.5,
        routing: 'tier2_required' as const,
        backendUsed: 'disabled',
        latencyMs: 0,
      })),
      stats: { total: steps.length, tier1Resolved: 0, tier2Required: steps.length, avgConfidence: 0.5, totalLatencyMs: 0 },
    };
  }

  const backend = createBackend(config);
  const tLow = config.tLow ?? 0.20;
  const tHigh = config.tHigh ?? 0.80;

  const t0 = performance.now();

  const pairs = steps.map(s => ({ stepId: s.stepId, step: s.description, trace: traceExcerpt }));
  const batchResults = await backend.scoreBatch(pairs);

  const totalLatencyMs = performance.now() - t0;

  const results: Tier1Result[] = batchResults.map((br, i) => {
    let routing: Tier1Result['routing'];

    if (br.confidence >= tHigh) {
      routing = 'tier1_supported';
    } else if (br.confidence <= tLow) {
      routing = 'tier1_unsupported';
    } else {
      routing = 'tier2_required';
    }

    return {
      stepId: br.stepId,
      stepDescription: steps[i].description,
      supported: br.supported,
      confidence: br.confidence,
      routing,
      backendUsed: backend.name,
      latencyMs: totalLatencyMs / steps.length,  // Amortized
    };
  });

  const tier1Resolved = results.filter(r => r.routing !== 'tier2_required').length;
  const avgConf = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  return {
    results,
    stats: {
      total: steps.length,
      tier1Resolved,
      tier2Required: results.length - tier1Resolved,
      avgConfidence: avgConf,
      totalLatencyMs,
    },
  };
}
