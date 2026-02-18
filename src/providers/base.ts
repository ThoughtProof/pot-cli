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
    headers: Record<string, string>,
    timeoutMs: number = 120000,
    maxRetries: number = 1
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s
        const backoffMs = 2000 * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = await response.text();
          const status = response.status;
          
          // Retry on 429 (rate limit), 500, 502, 503, 529 (overloaded)
          if (attempt < maxRetries && [429, 500, 502, 503, 529].includes(status)) {
            lastError = new Error(`API request failed: ${status} - ${error}`);
            continue;
          }
          
          throw new Error(`API request failed: ${status} - ${error}`);
        }

        return response.json();
      } catch (error: any) {
        if (error.name === 'AbortError') {
          lastError = new Error(`API request timed out after ${timeoutMs / 1000}s`);
          if (attempt < maxRetries) continue;
          throw lastError;
        }
        if (attempt < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
          lastError = error;
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error('Request failed after retries');
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
