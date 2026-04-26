import test from 'node:test';
import assert from 'node:assert/strict';

import { OllamaBackend, createBackend, type Tier1Config } from './tier1-prefilter.js';

// ─── Fetch-Mocking Helpers ──────────────────────────────────────────────────
//
// We replace globalThis.fetch with a per-test stub. Each stub records calls
// and returns a canned Response-like object so we can drive every branch of
// OllamaBackend.scoreStep without needing a live Ollama daemon.

interface FetchCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(impl: (url: string, init: RequestInit) => Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    calls.push({ url: urlStr, init: init ?? {} });
    return impl(urlStr, init ?? {});
  }) as typeof fetch;
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test('OllamaBackend.scoreStep: success path parses {supported, confidence}', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": true, "confidence": 0.85}',
    done: true,
  }));

  try {
    const backend = new OllamaBackend('http://localhost:11434', 'qwen2.5:7b');
    const result = await backend.scoreStep('The capital of France is Paris.', 'Paris is the capital of France.');

    assert.equal(result.supported, true);
    assert.equal(result.confidence, 0.85);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, 'http://localhost:11434/api/generate');

    const body = JSON.parse(String(mock.calls[0].init.body));
    assert.equal(body.model, 'qwen2.5:7b');
    assert.equal(body.stream, false);
    assert.equal(body.format, 'json');
    assert.equal(body.options.temperature, 0);
    assert.ok(typeof body.prompt === 'string' && body.prompt.includes('Paris'));
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: low-confidence success path round-trips correctly', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": false, "confidence": 0.05}',
    done: true,
  }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('Mars has a breathable atmosphere.', 'Mars has a thin CO2 atmosphere.');
    assert.equal(result.supported, false);
    assert.equal(result.confidence, 0.05);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: malformed JSON in response field → ambiguous (0.5)', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: 'this is not json at all, just prose',
    done: true,
  }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.supported, false);
    assert.equal(result.confidence, 0.5);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: empty response field → ambiguous (0.5)', async () => {
  const mock = installFetchMock(async () => jsonResponse({ response: '', done: true }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.supported, false);
    assert.equal(result.confidence, 0.5);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: ollama error field → ambiguous (0.5)', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    error: 'model not found: qwen2.5:7b',
  }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.supported, false);
    assert.equal(result.confidence, 0.5);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: HTTP non-2xx → ambiguous (0.5)', async () => {
  const mock = installFetchMock(async () => new Response('Internal Server Error', { status: 500 }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.supported, false);
    assert.equal(result.confidence, 0.5);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: network error (fetch throws) → ambiguous (0.5)', async () => {
  const mock = installFetchMock(async () => { throw new Error('ECONNREFUSED'); });

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.supported, false);
    assert.equal(result.confidence, 0.5);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: confidence clamped to [0,1]', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": true, "confidence": 1.7}',
  }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.confidence, 1);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: negative confidence clamped to 0', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": false, "confidence": -0.3}',
  }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.confidence, 0);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: missing confidence → defaults to 0.5', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": true}',
  }));

  try {
    const backend = new OllamaBackend();
    const result = await backend.scoreStep('claim', 'doc');
    assert.equal(result.supported, true);
    assert.equal(result.confidence, 0.5);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreBatch: runs sequentially and preserves stepIds', async () => {
  const responses = [
    { response: '{"supported": true, "confidence": 0.9}' },
    { response: '{"supported": false, "confidence": 0.1}' },
    { response: '{"supported": true, "confidence": 0.6}' },
  ];
  let i = 0;
  const mock = installFetchMock(async () => jsonResponse(responses[i++]));

  try {
    const backend = new OllamaBackend();
    const out = await backend.scoreBatch([
      { stepId: 's1', step: 'claim 1', trace: 'doc 1' },
      { stepId: 's2', step: 'claim 2', trace: 'doc 2' },
      { stepId: 's3', step: 'claim 3', trace: 'doc 3' },
    ]);

    assert.equal(out.length, 3);
    assert.deepEqual(out.map(r => r.stepId), ['s1', 's2', 's3']);
    assert.equal(out[0].supported, true);
    assert.equal(out[0].confidence, 0.9);
    assert.equal(out[1].supported, false);
    assert.equal(out[1].confidence, 0.1);
    assert.equal(out[2].supported, true);
    assert.equal(out[2].confidence, 0.6);
    assert.equal(mock.calls.length, 3);
  } finally {
    mock.restore();
  }
});

test('OllamaBackend: name reflects model tag', () => {
  const a = new OllamaBackend('http://localhost:11434', 'qwen2.5:7b');
  assert.equal(a.name, 'ollama:qwen2.5:7b');
  const b = new OllamaBackend('http://localhost:11434', 'llama3.2:3b');
  assert.equal(b.name, 'ollama:llama3.2:3b');
});

test('OllamaBackend: trailing slash in baseUrl is normalized', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": true, "confidence": 0.7}',
  }));

  try {
    const backend = new OllamaBackend('http://localhost:11434/', 'qwen2.5:7b');
    await backend.scoreStep('claim', 'doc');
    assert.equal(mock.calls[0].url, 'http://localhost:11434/api/generate');
  } finally {
    mock.restore();
  }
});

test('OllamaBackend.scoreStep: trace longer than 4000 chars is truncated in prompt', async () => {
  const mock = installFetchMock(async () => jsonResponse({
    response: '{"supported": true, "confidence": 0.7}',
  }));

  try {
    const longTrace = 'x'.repeat(8000) + 'TAIL_MARKER';
    const backend = new OllamaBackend();
    await backend.scoreStep('claim', longTrace);

    const body = JSON.parse(String(mock.calls[0].init.body));
    // Tail of the long trace must NOT appear in prompt (truncated to 4000 chars)
    assert.equal(body.prompt.includes('TAIL_MARKER'), false);
  } finally {
    mock.restore();
  }
});

test('createBackend: routes ollama backend with custom url and model', () => {
  const cfg: Tier1Config = {
    backend: 'ollama',
    ollamaUrl: 'http://192.168.1.10:11434',
    ollamaModel: 'llama3.2:3b',
  };
  const backend = createBackend(cfg);
  assert.equal(backend.name, 'ollama:llama3.2:3b');
});

test('createBackend: ollama backend uses defaults when config omits url/model', () => {
  const cfg: Tier1Config = { backend: 'ollama' };
  const backend = createBackend(cfg);
  assert.equal(backend.name, 'ollama:qwen2.5:7b');
});
