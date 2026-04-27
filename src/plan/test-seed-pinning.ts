/**
 * Tests for PR-G: Seed-Pinning for Reproducible CM Runs
 * ======================================================
 * Verifies that seed + temperature are correctly passed through the model router
 * to OpenAI-compatible and Anthropic API calls, and that DEFAULT_EVAL_SEED is stable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EVAL_SEED } from './graded-support-evaluator.js';

// Helper: create a mock fetch that captures the request body
function mockFetch(responseBody: unknown): { restore: () => void; getBody: () => Record<string, unknown> } {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};

  globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
    body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  return {
    restore: () => { globalThis.fetch = originalFetch; },
    getBody: () => body,
  };
}

const OPENAI_MOCK_RESPONSE = {
  choices: [{ message: { content: 'test response' } }],
  model: 'grok-4-1-fast',
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

const ANTHROPIC_MOCK_RESPONSE = {
  content: [{ text: 'test response' }],
  model: 'claude-sonnet-4-5-20250514',
  usage: { input_tokens: 10, output_tokens: 5 },
};

// ─── Test 1: Lock test — DEFAULT_EVAL_SEED is 42 ────────────────────────────

test('DEFAULT_EVAL_SEED is 42 (lock test)', () => {
  assert.equal(DEFAULT_EVAL_SEED, 42, 'DEFAULT_EVAL_SEED must be 42 — changing this breaks reproducibility of existing benchmark runs');
});

// ─── Test 2: callOpenAICompat includes seed in request body ──────────────────

test('callModel passes seed to OpenAI-compatible provider request body', async () => {
  const mock = mockFetch(OPENAI_MOCK_RESPONSE);
  const origKey = process.env.XAI_API_KEY;

  try {
    process.env.XAI_API_KEY = 'test-key-for-seed-pinning';

    const { callModel } = await import('../utils/model-router.js');
    await callModel('grok', [{ role: 'user', content: 'test' }], {
      maxTokens: 64,
      temperature: 0,
      seed: 42,
    });

    const body = mock.getBody();
    assert.equal(body.seed, 42, 'seed should be in request body');
    assert.equal(body.temperature, 0, 'temperature should be in request body');
    assert.equal(body.model, 'grok-4-1-fast', 'model should be in request body');
  } finally {
    process.env.XAI_API_KEY = origKey ?? '';
    mock.restore();
  }
});

// ─── Test 3: callAnthropic does NOT include seed in request body ─────────────

test('callModel does not pass seed to Anthropic provider request body', async () => {
  const mock = mockFetch(ANTHROPIC_MOCK_RESPONSE);
  const origKey = process.env.ANTHROPIC_API_KEY;

  try {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-seed-pinning';

    const { callModel } = await import('../utils/model-router.js');
    await callModel('sonnet', [{ role: 'user', content: 'test' }], {
      maxTokens: 64,
      temperature: 0,
      seed: 42,
    });

    const body = mock.getBody();
    assert.equal(body.seed, undefined, 'seed must NOT be in Anthropic request body');
    assert.equal(body.temperature, 0, 'temperature should still be in Anthropic request body');
  } finally {
    process.env.ANTHROPIC_API_KEY = origKey ?? '';
    mock.restore();
  }
});

// ─── Test 4: callOpenAICompat omits seed when not provided ───────────────────

test('callModel omits seed from request body when not provided', async () => {
  const mock = mockFetch(OPENAI_MOCK_RESPONSE);
  const origKey = process.env.XAI_API_KEY;

  try {
    process.env.XAI_API_KEY = 'test-key-for-seed-pinning';

    const { callModel } = await import('../utils/model-router.js');
    await callModel('grok', [{ role: 'user', content: 'test' }], {
      maxTokens: 64,
      temperature: 0,
    });

    const body = mock.getBody();
    assert.equal('seed' in body, false, 'seed field must not be present when not provided');
  } finally {
    process.env.XAI_API_KEY = origKey ?? '';
    mock.restore();
  }
});

// ─── Test 5: callModelStructured passes seed through ─────────────────────────

test('callModelStructured passes seed through to underlying API call', async () => {
  const mock = mockFetch({
    choices: [{ message: { content: '{"result": "ok"}' } }],
    model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const origKey = process.env.DEEPSEEK_API_KEY;

  try {
    process.env.DEEPSEEK_API_KEY = 'test-key-for-seed-pinning';

    const { callModelStructured } = await import('../utils/model-router.js');
    await callModelStructured('deepseek', [{ role: 'user', content: 'test' }], {
      parse: (text: string) => JSON.parse(text),
      maxTokens: 64,
      temperature: 0,
      seed: 42,
    });

    const body = mock.getBody();
    assert.equal(body.seed, 42, 'seed should be passed through callModelStructured');
  } finally {
    process.env.DEEPSEEK_API_KEY = origKey ?? '';
    mock.restore();
  }
});
