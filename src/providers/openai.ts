import { BaseProvider } from './base.js';
import { APIResponse } from '../types.js';

export class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  protected baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string, providerName?: string) {
    super(apiKey);
    this.name = providerName || 'OpenAI';
    this.baseUrl = baseUrl || 'https://api.openai.com/v1/chat/completions';
  }

  async call(model: string, prompt: string): Promise<APIResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.name} API key not configured`);
    }

    const response = await this.makeRequest(
      this.baseUrl,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8192,
      },
      {
        'Authorization': `Bearer ${this.apiKey}`,
      }
    );

    const message = response.choices[0].message;
    // Reasoning models (kimi-k2-thinking*) put output in reasoning_content, content may be empty
    const content = message.content || message.reasoning_content || '';
    const tokens = response.usage?.total_tokens || 0;
    const cost = this.estimateCost(tokens, model);

    return { content, tokens, cost };
  }
}

export class XAIProvider extends OpenAIProvider {
  name = 'xAI';
  
  constructor(apiKey?: string) {
    super(apiKey, 'https://api.x.ai/v1/chat/completions');
  }
}

export class MoonshotProvider extends OpenAIProvider {
  name = 'Moonshot';
  
  constructor(apiKey?: string) {
    super(apiKey, 'https://api.moonshot.ai/v1/chat/completions');
  }
}

export class DeepSeekProvider extends OpenAIProvider {
  name = 'DeepSeek';
  
  constructor(apiKey?: string) {
    super(apiKey, 'https://api.deepseek.com/chat/completions');
  }
}
