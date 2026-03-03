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
  'sonnet': { baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5-20250514', type: 'anthropic' },

  // xAI
  'grok': { baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', model: 'grok-4-1-fast', type: 'openai' },

  // DeepSeek
  'deepseek': { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', type: 'openai' },
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
  options: { maxTokens?: number } = {},
): Promise<ModelResponse> {
  const config = resolveModel(modelName);
  const maxTokens = options.maxTokens ?? 1024;

  if (config.type === 'anthropic') {
    return callAnthropic(config, messages, maxTokens);
  }
  return callOpenAICompat(config, messages, maxTokens);
}

export function listModels(): string[] {
  return Object.keys(MODELS);
}
