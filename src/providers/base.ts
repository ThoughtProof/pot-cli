import { Provider, APIResponse } from '../types.js';

export abstract class BaseProvider implements Provider {
  abstract name: string;
  protected apiKey?: string;
  protected baseUrl: string = '';

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  abstract call(model: string, prompt: string): Promise<APIResponse>;

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  protected async makeRequest(
    url: string,
    body: any,
    headers: Record<string, string>
  ): Promise<any> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  protected estimateCost(tokens: number, model: string): number {
    // Simplified cost estimation (per 1M tokens)
    const costPer1M: Record<string, number> = {
      'claude-sonnet': 3.0,
      'claude-opus': 15.0,
      'gpt-4': 30.0,
      'grok': 5.0,
      'moonshot': 1.0,
    };

    for (const [key, cost] of Object.entries(costPer1M)) {
      if (model.toLowerCase().includes(key)) {
        return (tokens / 1_000_000) * cost;
      }
    }

    return (tokens / 1_000_000) * 2.0; // Default fallback
  }
}
