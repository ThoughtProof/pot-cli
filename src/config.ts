import { readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PotConfig, GeneratorConfig, Provider } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';

// Default base URLs for known providers
export const DEFAULT_BASE_URLS: Record<string, string> = {
  'xai': 'https://api.x.ai/v1/chat/completions',
  'grok': 'https://api.x.ai/v1/chat/completions',
  'moonshot': 'https://api.moonshot.ai/v1/chat/completions',
  'kimi': 'https://api.moonshot.ai/v1/chat/completions',
  'deepseek': 'https://api.deepseek.com/chat/completions',
  'openai': 'https://api.openai.com/v1/chat/completions',
  'google': 'https://generativelanguage.googleapis.com/v1beta/openai',
  'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
  'mistral': 'https://api.mistral.ai/v1/chat/completions',
  'groq': 'https://api.groq.com/openai/v1/chat/completions',
};

// Known provider presets: env var → { name, model, baseUrl? }
const PROVIDER_PRESETS: Array<{
  envVar: string;
  name: string;
  model: string;
  baseUrl?: string;
  isAnthropic?: boolean;
}> = [
  { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic', model: 'claude-sonnet-4-6', isAnthropic: true },
  { envVar: 'XAI_API_KEY',       name: 'xAI',       model: 'grok-4-1-fast',     baseUrl: DEFAULT_BASE_URLS['xai'] },
  { envVar: 'OPENAI_API_KEY',    name: 'OpenAI',    model: 'gpt-4o',             baseUrl: DEFAULT_BASE_URLS['openai'] },
  { envVar: 'DEEPSEEK_API_KEY',  name: 'DeepSeek',  model: 'deepseek-chat',      baseUrl: DEFAULT_BASE_URLS['deepseek'] },
  { envVar: 'MOONSHOT_API_KEY',  name: 'Moonshot',  model: 'kimi-k2-turbo-preview', baseUrl: DEFAULT_BASE_URLS['moonshot'] },
  { envVar: 'MISTRAL_API_KEY',   name: 'Mistral',   model: 'mistral-large-latest',  baseUrl: DEFAULT_BASE_URLS['mistral'] },
  { envVar: 'GROQ_API_KEY',      name: 'Groq',      model: 'llama-3.3-70b-versatile', baseUrl: DEFAULT_BASE_URLS['groq'] },
  { envVar: 'GOOGLE_API_KEY',    name: 'Google',    model: 'gemini-2.0-flash',    baseUrl: DEFAULT_BASE_URLS['google'] },
];

/**
 * Build default config by auto-detecting available providers from env vars.
 * No hardcoded model mix — user's environment determines what's available.
 * Roles are assigned by position: all except last two = generators,
 * second-to-last = critic, last = synthesizer. With <2 providers, all roles overlap.
 */
function buildDefaultConfig(): PotConfig {
  const detected: GeneratorConfig[] = [];

  for (const preset of PROVIDER_PRESETS) {
    const apiKey = process.env[preset.envVar];
    if (apiKey) {
      detected.push({
        name: preset.name,
        model: preset.model,
        apiKey,
        ...(preset.isAnthropic ? { provider: 'anthropic' as const } : { baseUrl: preset.baseUrl }),
      });
    }
  }

  if (detected.length === 0) {
    // No API keys set — return empty shell (will error at runtime with helpful message)
    return { generators: [], blockStoragePath: './blocks', language: 'de' };
  }

  // Auto-assign roles by position (mirrors pot-sdk v0.2 assignRoles logic)
  const generators = detected;
  const critic = detected.length >= 2 ? detected[detected.length - 2] : detected[0];
  const synthesizer = detected[detected.length - 1];

  return { generators, critic, synthesizer, blockStoragePath: './blocks', language: 'de' };
}

/**
 * Migrate old config format to new format
 */
function migrateConfig(config: PotConfig): PotConfig {
  // If new format already present, return as-is
  if (config.generators && config.critic && config.synthesizer) {
    return config;
  }

  // Otherwise, migrate from old format
  // Legacy migration: models/apiKeys from old .potrc.json format
  const models = config.models || {
    generator1: '', generator2: '', generator3: '', generator4: '', critic: '', synthesizer: ''
  };
  const apiKeys = config.apiKeys || {};

  const generators: GeneratorConfig[] = [
    {
      name: 'xAI',
      model: models.generator1,
      baseUrl: DEFAULT_BASE_URLS['xai'],
      apiKey: apiKeys.xai || '',
    },
    {
      name: 'Moonshot',
      model: models.generator2,
      baseUrl: DEFAULT_BASE_URLS['moonshot'],
      apiKey: apiKeys.moonshot || '',
    },
    {
      name: 'Anthropic',
      model: models.generator3,
      provider: 'anthropic',
      apiKey: apiKeys.anthropic || '',
    },
    {
      name: 'DeepSeek',
      model: models.generator4,
      baseUrl: DEFAULT_BASE_URLS['deepseek'],
      apiKey: apiKeys.deepseek || '',
    },
  ];

  const critic: GeneratorConfig = {
    name: 'Anthropic',
    model: models.critic,
    provider: 'anthropic',
    apiKey: apiKeys.anthropic || '',
  };

  const synthesizer: GeneratorConfig = {
    name: 'Anthropic',
    model: models.synthesizer,
    provider: 'anthropic',
    apiKey: apiKeys.anthropic || '',
  };

  return {
    generators,
    critic,
    synthesizer,
    blockStoragePath: config.blockStoragePath,
    language: config.language,
  };
}

/**
 * Detect base URL from provider name or model name if not explicitly set
 */
function detectBaseUrl(providerName: string, model: string): string {
  const nameLower = providerName.toLowerCase();
  const modelLower = model.toLowerCase();

  // Try exact name match first
  if (DEFAULT_BASE_URLS[nameLower]) {
    return DEFAULT_BASE_URLS[nameLower];
  }

  // Try model name patterns
  for (const [key, url] of Object.entries(DEFAULT_BASE_URLS)) {
    if (modelLower.includes(key)) {
      return url;
    }
  }

  // Fallback to OpenAI
  return DEFAULT_BASE_URLS['openai'];
}

/**
 * Create a Provider instance from GeneratorConfig
 */
export function createProvider(config: GeneratorConfig): Provider {
  // Anthropic uses Messages API (not OpenAI-compatible)
  if (config.provider === 'anthropic') {
    return new AnthropicProvider(config.apiKey, config.name);
  }

  // Everyone else is OpenAI-compatible
  const baseUrl = config.baseUrl || detectBaseUrl(config.name, config.model);
  return new OpenAIProvider(config.apiKey, baseUrl, config.name);
}

/**
 * Create all providers from config (generators, critic, synthesizer)
 */
export function createProvidersFromConfig(config: PotConfig): {
  generators: { provider: Provider; model: string }[];
  critic: { provider: Provider; model: string };
  synthesizer: { provider: Provider; model: string };
} {
  const migrated = migrateConfig(config);

  if (!migrated.generators || migrated.generators.length === 0) {
    throw new Error(
      'No providers configured.\n' +
      'Set at least one API key env var (ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, etc.)\n' +
      'or add providers to ~/.potrc.json via: pot config add-provider'
    );
  }

  const generators = migrated.generators.map(g => ({
    provider: createProvider(g),
    model: g.model,
  }));

  const critic = {
    provider: createProvider(migrated.critic!),
    model: migrated.critic!.model,
  };

  const synthesizer = {
    provider: createProvider(migrated.synthesizer!),
    model: migrated.synthesizer!.model,
  };

  return { generators, critic, synthesizer };
}

export function loadConfig(): PotConfig {
  const configPaths = [
    join(process.cwd(), '.potrc.json'),
    join(homedir(), '.potrc.json'),
  ];

  for (const path of configPaths) {
    if (existsSync(path)) {
      try {
        const fileConfig = JSON.parse(readFileSync(path, 'utf-8'));
        // Merge file config with env-var defaults (file takes precedence)
        const defaults = buildDefaultConfig();
        const merged = { ...defaults, ...fileConfig };
        return migrateConfig(merged);
      } catch (error) {
        console.error(`Failed to parse config at ${path}`);
      }
    }
  }

  // No config file — build from environment
  return buildDefaultConfig();
}

export function saveConfig(config: PotConfig): void {
  const configPath = join(homedir(), '.potrc.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getConfig(): PotConfig {
  return loadConfig();
}

export function loadSystemContext(): string {
  const contextPaths = [
    join(process.cwd(), 'system-context.md'),
    join(homedir(), '.pot-system-context.md'),
  ];

  for (const path of contextPaths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        return `\nSYSTEM CONTEXT (always consider this):\n${content}\n`;
      } catch {
        // ignore
      }
    }
  }

  return '';
}
