import { readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { PotConfig, GeneratorConfig, Provider } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';

// Default base URLs for known providers
const DEFAULT_BASE_URLS: Record<string, string> = {
  'xai': 'https://api.x.ai/v1/chat/completions',
  'grok': 'https://api.x.ai/v1/chat/completions',
  'moonshot': 'https://api.moonshot.ai/v1/chat/completions',
  'kimi': 'https://api.moonshot.ai/v1/chat/completions',
  'deepseek': 'https://api.deepseek.com/chat/completions',
  'openai': 'https://api.openai.com/v1/chat/completions',
};

const DEFAULT_CONFIG: PotConfig = {
  models: {
    generator1: 'grok-4-1-fast',
    generator2: 'kimi-k2.5',
    generator3: 'claude-sonnet-4-5-20250929',
    generator4: 'deepseek-chat',
    critic: 'claude-opus-4-6',
    synthesizer: 'claude-opus-4-6',
  },
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    xai: process.env.XAI_API_KEY,
    moonshot: process.env.MOONSHOT_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
  },
  blockStoragePath: './blocks',
  language: 'de',
};

/**
 * Migrate old config format to new format
 */
function migrateConfig(config: PotConfig): PotConfig {
  // If new format already present, return as-is
  if (config.generators && config.critic && config.synthesizer) {
    return config;
  }

  // Otherwise, migrate from old format
  const models = config.models || DEFAULT_CONFIG.models!;
  const apiKeys = config.apiKeys || DEFAULT_CONFIG.apiKeys!;

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

  if (!migrated.generators || migrated.generators.length < 3) {
    throw new Error('Config must have at least 3 generators (model diversity requirement)');
  }

  // Check name uniqueness for diversity
  const names = new Set(migrated.generators.map(g => g.name));
  if (names.size < 3) {
    throw new Error('Generators must have at least 3 different provider names for model diversity');
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
        const merged = { ...DEFAULT_CONFIG, ...fileConfig };
        return migrateConfig(merged);
      } catch (error) {
        console.error(`Failed to parse config at ${path}`);
      }
    }
  }

  return migrateConfig(DEFAULT_CONFIG);
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
