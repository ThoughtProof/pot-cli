/**
 * Model Router — Universal LLM access for pot-cli
 * =================================================
 * Maps model aliases to provider-specific API endpoints.
 * All providers use OpenAI-compatible chat/completions or Anthropic messages API.
 *
 * Usage:
 *   const response = await callModel('grok', messages, { maxTokens: 1024 });
 *   const response = await callModel('kimi', messages);
 *   const response = await callModel('sonnet', messages);
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelResponse {
  content: string;
  model: string;
  usage?: { input: number; output: number };
}

interface ProviderConfig {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  type: 'openai' | 'anthropic';
}

// ─── Model Registry ───────────────────────────────────────────────────────────

const MODELS: Record<string, ProviderConfig> = {
  // Anthropic
  'opus': { baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-opus-4-6-20250414', type: 'anthropic' },
  'sonnet': { baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6-20250514', type: 'anthropic' },

  // xAI
  'grok': { baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', model: 'grok-4-1-fast', type: 'openai' },

  // Google Gemini (direct API — OpenAI-compatible endpoint)
  // Gemini (direct Google API — OpenAI-compatible endpoint)
  'gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY', model: 'gemini-3.1-flash-lite-preview', type: 'openai' },
  'gemini-flash': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY', model: 'gemini-3.1-flash-lite-preview', type: 'openai' },
  'gemini-2.5': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', type: 'openai' },

  // DeepSeek
  // DeepSeek (direct API)
  'deepseek': { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-v4-flash', type: 'openai' },
  'deepseek-pro': { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-v4-pro', type: 'openai' },
  'deepseek-r1': { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-reasoner', type: 'openai' },

  // Moonshot (Kimi)
  'kimi': { baseUrl: 'https://api.moonshot.ai/v1', apiKeyEnv: 'MOONSHOT_API_KEY', model: 'kimi-k2.5', type: 'openai' },
};

// Allow full model strings like "anthropic/claude-sonnet-4-5" or "xai/grok-4-1-fast"
function resolveModel(nameOrAlias: string): ProviderConfig {
  // Check aliases first
  const lower = nameOrAlias.toLowerCase();
  if (MODELS[lower]) return MODELS[lower];

  // Check if it's a provider/model string
  if (nameOrAlias.includes('/')) {
    const [provider, model] = nameOrAlias.split('/', 2);
    switch (provider.toLowerCase()) {
      case 'anthropic':
        return { baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', model, type: 'anthropic' };
      case 'xai':
        return { baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', model, type: 'openai' };
      case 'deepseek':
        return { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', model, type: 'openai' };
      case 'moonshot':
      case 'openai':
        if (model.startsWith('kimi')) {
          return { baseUrl: 'https://api.moonshot.ai/v1', apiKeyEnv: 'MOONSHOT_API_KEY', model, type: 'openai' };
        }
        return { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', model, type: 'openai' };
      case 'google':
        return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY', model, type: 'openai' };
      default:
        // Unknown provider — try OpenAI-compatible
        return { baseUrl: `https://api.${provider}.com/v1`, apiKeyEnv: `${provider.toUpperCase()}_API_KEY`, model, type: 'openai' };
    }
  }

  throw new Error(`Unknown model: ${nameOrAlias}. Available: ${Object.keys(MODELS).join(', ')}`);
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function callAnthropic(
  config: ProviderConfig,
  messages: ChatMessage[],
  maxTokens: number,
  temperature?: number,
): Promise<ModelResponse> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing env: ${config.apiKeyEnv}`);

  const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
  const chatMsgs = messages.filter(m => m.role !== 'system');

  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      system: systemMsg,
      messages: chatMsgs.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as {
    content?: Array<{ text?: string }>;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  return {
    content: data.content?.[0]?.text ?? '',
    model: data.model ?? config.model,
    usage: data.usage ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 } : undefined,
  };
}

async function callOpenAICompat(
  config: ProviderConfig,
  messages: ChatMessage[],
  maxTokens: number,
  temperature?: number,
): Promise<ModelResponse> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing env: ${config.apiKeyEnv}`);

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${config.baseUrl} ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? config.model,
    usage: data.usage ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 } : undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function callModel(
  modelName: string,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<ModelResponse> {
  const config = resolveModel(modelName);
  const maxTokens = options.maxTokens ?? 1024;

  if (config.type === 'anthropic') {
    return callAnthropic(config, messages, maxTokens, options.temperature);
  }
  return callOpenAICompat(config, messages, maxTokens, options.temperature);
}

export function listModels(): string[] {
  return Object.keys(MODELS);
}

// ─── Structured Output (Instructor-style, no deps) ───────────────────────────

/**
 * Call a model and parse the response into a typed structure.
 * Retries up to `retries` times if parsing fails.
 *
 * Usage:
 *   const result = await callModelStructured('grok', messages, {
 *     parse: (text) => {
 *       const m = text.match(/Verdict:\s*(vulnerability|false_positive)/i);
 *       if (!m) throw new Error('No verdict found');
 *       return { verdict: m[1].toLowerCase(), confidence: parseFloat(text.match(/Confidence:\s*([\d.]+)/)?.[1] ?? '0.5') };
 *     },
 *     retries: 2,
 *   });
 */
export async function callModelStructured<T>(
  modelName: string,
  messages: ChatMessage[],
  options: {
    parse: (text: string) => T;
    retries?: number;
    maxTokens?: number;
    temperature?: number;
    onRetry?: (attempt: number, error: Error) => void;
  },
): Promise<{ data: T; raw: string; model: string; attempts: number }> {
  const maxRetries = options.retries ?? 2;
  let lastError: Error = new Error('No attempts made');
  let raw = '';

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await callModel(modelName, messages, { maxTokens: options.maxTokens, temperature: options.temperature });
      raw = response.content;
      const data = options.parse(raw);
      return { data, raw, model: response.model, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt <= maxRetries) {
        options.onRetry?.(attempt, lastError);
        // Add a hint to the messages for retry
        messages = [
          ...messages,
          { role: 'assistant' as const, content: raw },
          {
            role: 'user' as const,
            content: `Your response could not be parsed: ${lastError.message}. Please respond again with the exact required format.`,
          },
        ];
      }
    }
  }

  throw new Error(`Failed after ${maxRetries + 1} attempts. Last error: ${lastError.message}`);
}

// ─── Pre-built Parsers ───────────────────────────────────────────────────────

export const Parsers = {
  /** Parse verdict/confidence/reasoning from audit critic response */
  auditCritic(text: string): { verdict: 'vulnerability' | 'false_positive'; confidence: number; reasoning: string } {
    const verdictMatch = text.match(/Verdict:\s*(vulnerability|false_positive)/i);
    if (!verdictMatch) throw new Error('Missing "Verdict: vulnerability" or "Verdict: false_positive"');

    const confMatch = text.match(/Confidence:\s*([\d.]+)/i);
    const reasonMatch = text.match(/Reasoning:\s*([\s\S]+)/i);

    const verdictRaw = verdictMatch[1].toLowerCase();
    return {
      verdict: verdictRaw.includes('false') ? 'false_positive' : 'vulnerability',
      confidence: confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5,
      reasoning: reasonMatch?.[1]?.trim() ?? text.trim(),
    };
  },

  /** Parse PASS/FAIL verdict from payment critic */
  paymentCritic(text: string): { verdict: 'PASS' | 'FAIL'; confidence: number; signal: string } {
    const verdictMatch = text.match(/(?:verdict|decision):\s*(PASS|FAIL)/i);
    if (!verdictMatch) throw new Error('Missing "Verdict: PASS" or "Verdict: FAIL"');

    const confMatch = text.match(/[Cc]onfidence:\s*([\d.]+)/);
    const signalMatch = text.match(/[Ss]ignal:\s*(.+)/);

    return {
      verdict: verdictMatch[1].toUpperCase() as 'PASS' | 'FAIL',
      confidence: confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5,
      signal: signalMatch?.[1]?.trim() ?? '',
    };
  },

  /** Generic JSON extraction — finds first {...} in response */
  json<T = Record<string, unknown>>(text: string): T {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    return JSON.parse(match[0]) as T;
  },
};
