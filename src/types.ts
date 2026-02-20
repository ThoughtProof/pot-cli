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

export interface SynthesisBalanceDetail {
  generator: string;  // model name
  coverage: number;   // fraction 0-1 of this generator's keywords found in synthesis
  share: number;      // share of total coverage (0-1), ideally 1/N for N generators
}

export interface SynthesisBalance {
  score: number;                         // 0-1, 1 = perfectly balanced
  generator_coverage: SynthesisBalanceDetail[];
  dominated_by?: string;                 // model name if any generator >60% share
  warning: boolean;
}

export interface SynthesisVerification {
  verified: boolean;       // true if both syntheses converge
  diverged: boolean;       // true if they significantly differ
  similarity_score: number;// 0-1 Jaccard-based similarity
  alt_synthesis?: string;  // second synthesis content (if diverged)
  alt_model?: string;      // model used for second synthesis
}

export interface Metadata {
  total_tokens: number;
  total_cost_usd: number;
  duration_seconds: number;
  model_diversity_index: number;
  dissent_score?: number;
  synthesis_balance?: SynthesisBalance;
  synthesis_verification?: SynthesisVerification;
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
