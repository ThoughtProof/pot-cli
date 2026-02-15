import { BaseProvider } from './base.js';
import { APIResponse } from '../types.js';

export class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  protected baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    super(apiKey);
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
        max_tokens: 4096,
      },
      {
        'Authorization': `Bearer ${this.apiKey}`,
      }
    );

    const content = response.choices[0].message.content;
    const tokens = response.usage.total_tokens;
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
    super(apiKey, 'https://api.moonshot.cn/v1/chat/completions');
  }
}
