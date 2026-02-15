export interface PotConfig {
  models: {
    generator1: string;
    generator2: string;
    generator3: string;
    critic: string;
    synthesizer: string;
  };
  apiKeys: {
    anthropic?: string;
    openai?: string;
    xai?: string;
    moonshot?: string;
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
