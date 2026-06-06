import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, normalizeBaseUrl } from '../dist/config.js';

// ─── normalizeBaseUrl ────────────────────────────────────────────────────────

test('normalizeBaseUrl: appends /chat/completions to /v1', () => {
  assert.equal(
    normalizeBaseUrl('https://compute.virtuals.io/v1'),
    'https://compute.virtuals.io/v1/chat/completions'
  );
});

test('normalizeBaseUrl: strips trailing slash before appending', () => {
  assert.equal(
    normalizeBaseUrl('https://compute.virtuals.io/v1/'),
    'https://compute.virtuals.io/v1/chat/completions'
  );
});

test('normalizeBaseUrl: passes through /chat/completions unchanged', () => {
  const url = 'https://api.openai.com/v1/chat/completions';
  assert.equal(normalizeBaseUrl(url), url);
});

test('normalizeBaseUrl: passes through non-standard paths unchanged', () => {
  assert.equal(
    normalizeBaseUrl('https://localhost:8080/custom'),
    'https://localhost:8080/custom'
  );
});

test('normalizeBaseUrl: handles multiple trailing slashes', () => {
  assert.equal(
    normalizeBaseUrl('https://api.example.com/v1///'),
    'https://api.example.com/v1/chat/completions'
  );
});

// ─── createProvider: explicit openai-compatible ──────────────────────────────

test('createProvider: openai-compatible + claude model → OpenAIProvider', () => {
  const provider = createProvider({
    name: 'Virtuals',
    model: 'claude-opus-4-7-fast',
    provider: 'openai-compatible',
    baseUrl: 'https://compute.virtuals.io/v1',
    apiKey: 'acp-test',
  });
  assert.equal(provider.constructor.name, 'OpenAIProvider');
  assert.equal(provider.name, 'Virtuals');
});

test('createProvider: openai-compatible without baseUrl → OpenAI default', () => {
  const provider = createProvider({
    name: 'Custom',
    model: 'claude-sonnet-4-6',
    provider: 'openai-compatible',
    apiKey: 'test-key',
  });
  assert.equal(provider.constructor.name, 'OpenAIProvider');
});

// ─── createProvider: explicit baseUrl overrides auto-detect ──────────────────

test('createProvider: baseUrl set + claude model → OpenAIProvider (not Anthropic)', () => {
  const provider = createProvider({
    name: 'Proxy',
    model: 'claude-opus-4-7-fast',
    baseUrl: 'https://compute.virtuals.io/v1',
    apiKey: 'proxy-key',
  });
  assert.equal(provider.constructor.name, 'OpenAIProvider');
});

test('createProvider: baseUrl set + deepseek model → OpenAIProvider with correct URL', () => {
  const provider = createProvider({
    name: 'Proxy',
    model: 'deepseek-v4-flash',
    baseUrl: 'https://compute.virtuals.io/v1',
    apiKey: 'proxy-key',
  });
  assert.equal(provider.constructor.name, 'OpenAIProvider');
});

// ─── createProvider: standard Anthropic preserved ────────────────────────────

test('createProvider: provider=anthropic → AnthropicProvider', () => {
  const provider = createProvider({
    name: 'Anthropic',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
  });
  assert.equal(provider.constructor.name, 'AnthropicProvider');
});

test('createProvider: provider=anthropic + baseUrl → AnthropicProvider (baseUrl ignored for security)', () => {
  const provider = createProvider({
    name: 'Anthropic',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    baseUrl: 'https://malicious.example.com/v1',
    apiKey: 'sk-ant-test',
  });
  assert.equal(provider.constructor.name, 'AnthropicProvider');
});

// ─── createProvider: auto-detect still works ─────────────────────────────────

test('createProvider: claude model without baseUrl → auto-detect to Anthropic', () => {
  const provider = createProvider({
    name: 'Default',
    model: 'claude-sonnet-4-6',
    apiKey: 'sk-ant-test',
  });
  assert.equal(provider.constructor.name, 'AnthropicProvider');
});

test('createProvider: gpt model without baseUrl → auto-detect to OpenAI', () => {
  const provider = createProvider({
    name: 'Default',
    model: 'gpt-4o',
    apiKey: 'sk-test',
  });
  assert.equal(provider.constructor.name, 'OpenAIProvider');
});

test('createProvider: unknown model without baseUrl → fallback to OpenAI', () => {
  const provider = createProvider({
    name: 'Unknown',
    model: 'some-random-model',
    apiKey: 'test-key',
  });
  assert.equal(provider.constructor.name, 'OpenAIProvider');
});
