// New flexible generator config (BYOK)
export interface GeneratorConfig {
  name: string;
  model: string;
  provider?: 'anthropic'; // If set, use Anthropic Messages API (not OpenAI-compatible)
  baseUrl?: string; // OpenAI-compatible endpoint (optional, defaults based on provider name)
  apiKey: string;
}

export interface PotConfig {
  // New flexible config
  generators?: GeneratorConfig[];
  critic?: GeneratorConfig;
  synthesizer?: GeneratorConfig;
  
  // Legacy config (for backward compatibility) - will be migrated internally
  models?: {
    generator1: string;
    generator2: string;
    generator3: string;
    generator4: string;
    critic: string;
    synthesizer: string;
  };
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    xai?: string;
    moonshot?: string;
    deepseek?: string;
  };
  
  // Search/verification provider (e.g., Perplexity Sonar for web-grounded fact-checking)
  search?: {
    apiKey: string;
    baseUrl?: string; // defaults to https://api.perplexity.ai
    model?: string; // defaults to 'sonar'
  };
  
  blockStoragePath: string;
  language: 'de' | 'en';
}

export interface Block {
  id: string;
  version: string;
  timestamp: string;
  question: string;
  normalized_question: string;
  proposals: Proposal[];
  critique: Critique;
  synthesis: Synthesis;
  metadata: Metadata;
  context_refs?: string[];
}

export interface Proposal {
  model: string;
  role: 'generator';
  content: string;
}

export interface Critique {
  model: string;
  role: 'critic';
  content: string;
}

export interface Synthesis {
  model: string;
  role: 'synthesizer';
  content: string;
}

export interface Metadata {
  total_tokens: number;
  total_cost_usd: number;
  duration_seconds: number;
  model_diversity_index: number;
  dissent_score?: number;
}

export interface APIResponse {
  content: string;
  tokens: number;
  cost: number;
}

export interface Provider {
  name: string;
  call(model: string, prompt: string): Promise<APIResponse>;
  isAvailable(): boolean;
}
