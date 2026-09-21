/**
 * Provider tests. A local HTTP server plays the part of a model runtime so that the documented
 * request shape and the typed failure mapping are asserted without needing Ollama installed.
 *
 * @module tests/provider
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/models/ollama-provider.mjs';
import { createScriptedProvider } from '../src/models/scripted-provider.mjs';
import { createProvider } from '../src/models/provider.mjs';
import { startLocalServer } from './helpers/fixtures.mjs';

/** @type {any} */
let lastRequest = null;

function chatHandler(/** @type {any} */ body, /** @type {number} */ status = 200) {
  return (/** @type {any} */ req, /** @type {any} */ res) => {
    let raw = '';
    req.on('data', (/** @type {any} */ chunk) => {
      raw += String(chunk);
    });
    req.on('end', () => {
      lastRequest = JSON.parse(raw);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(typeof body === 'function' ? JSON.stringify(body()) : JSON.stringify(body));
    });
  };
}

function request() {
  return {
    systemPrompt: 'system rules',
    userMessage: 'create a customer named Acme Electrical',
    formatSchema: { type: 'object' }
  };
}

test('the request uses the documented native chat contract and never sends tools', async () => {
  const server = await startLocalServer(
    chatHandler({ message: { role: 'assistant', content: 'ok' }, done: true, done_reason: 'stop', eval_count: 12, total_duration: 5_000_000 })
  );
  try {
    const provider = createOllamaProvider({ baseUrl: server.url, model: 'test-model', numCtx: 4096, seed: 11, temperature: 0, keepAlive: '2m' });
    const result = await provider.complete(request());
    assert.equal(result.text, 'ok');
    assert.equal(lastRequest.model, 'test-model');
    assert.equal(lastRequest.stream, false, 'streaming must be explicit');
    assert.equal(lastRequest.keep_alive, '2m');
    assert.deepEqual(lastRequest.options, { temperature: 0, seed: 11, num_ctx: 4096 });
    assert.equal(typeof lastRequest.format, 'object', 'the envelope schema is sent as a format constraint');
    assert.equal('tools' in lastRequest, false, 'v0.1 never uses the tools API');
    assert.equal(lastRequest.messages[0].role, 'system');
    assert.equal(lastRequest.messages[1].role, 'user');
    assert.equal(result.meta.evalCount, 12);
  } finally {
    await server.close();
  }
});

test('done_reason values other than stop are accepted (a load is not a failure)', async () => {
  const server = await startLocalServer(chatHandler({ message: { role: 'assistant', content: '{}' }, done: true, done_reason: 'load' }));
  try {
    const provider = createOllamaProvider({ baseUrl: server.url, model: 'test-model' });
    const result = await provider.complete(request());
    assert.equal(result.meta.doneReason, 'load');
  } finally {
    await server.close();
  }
});

test('a missing model is reported as a missing model, not as a generic failure', async () => {
  const server = await startLocalServer(chatHandler({ error: "model 'test-model' not found" }, 404));
  try {
    const provider = createOllamaProvider({ baseUrl: server.url, model: 'test-model' });
    await assert.rejects(() => provider.complete(request()), (/** @type {any} */ err) => {
      assert.equal(/** @type {any} */ (err).code, 'PROVIDER_MODEL_MISSING');
      return true;
    });
  } finally {
    await server.close();
  }
});

test('server errors, malformed bodies and missing content map to typed provider errors', async () => {
  const fiveHundred = await startLocalServer(chatHandler({ error: 'queue overflow' }, 503));
  try {
    const provider = createOllamaProvider({ baseUrl: fiveHundred.url, model: 'm' });
    await assert.rejects(() => provider.complete(request()), (/** @type {any} */ err) => {
      assert.equal(/** @type {any} */ (err).code, 'PROVIDER_HTTP_ERROR');
      return true;
    });
  } finally {
    await fiveHundred.close();
  }

  const badBody = await startLocalServer((req, res) => {
    res.statusCode = 200;
    res.end('this is not json');
  });
  try {
    const provider = createOllamaProvider({ baseUrl: badBody.url, model: 'm' });
    await assert.rejects(() => provider.complete(request()), (/** @type {any} */ err) => {
      assert.equal(/** @type {any} */ (err).code, 'PROVIDER_BAD_RESPONSE');
      return true;
    });
  } finally {
    await badBody.close();
  }

  const noContent = await startLocalServer(chatHandler({ message: { role: 'assistant' } }));
  try {
    const provider = createOllamaProvider({ baseUrl: noContent.url, model: 'm' });
    await assert.rejects(() => provider.complete(request()), (/** @type {any} */ err) => {
      assert.equal(/** @type {any} */ (err).code, 'PROVIDER_BAD_RESPONSE');
      return true;
    });
  } finally {
    await noContent.close();
  }
});

test('an unreachable runtime and a timeout are distinct, typed failures', async () => {
  const unreachable = createOllamaProvider({ baseUrl: 'http://127.0.0.1:1', model: 'm', timeoutMs: 1500 });
  await assert.rejects(() => unreachable.complete(request()), (/** @type {any} */ err) => {
    assert.equal(/** @type {any} */ (err).code, 'PROVIDER_UNAVAILABLE');
    return true;
  });

  const server = await startLocalServer(() => {
    /* never responds */
  });
  try {
    const slow = createOllamaProvider({ baseUrl: server.url, model: 'm', timeoutMs: 250 });
    await assert.rejects(() => slow.complete(request()), (/** @type {any} */ err) => {
      assert.equal(/** @type {any} */ (err).code, 'PROVIDER_TIMEOUT');
      return true;
    });
  } finally {
    await server.close();
  }
});

test('an unconfigured model name is refused instead of choosing a model family', () => {
  assert.throws(() => createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'REPLACE_WITH_YOUR_MODEL' }), /provider\.model is not configured/);
  assert.throws(() => createProvider({ .../** @type {any} */ ({}) }), /Cannot read|undefined/);
});

test('the scripted provider replays fixtures and refuses to invent a response', async () => {
  const provider = createScriptedProvider({ script: [{ prompt: 'hello', response: '{"kind":"unsupported","reason":"no","reasoningSummary":"x"}' }] });
  const result = await provider.complete({ systemPrompt: '', userMessage: 'hello', formatSchema: {} });
  assert.match(result.text, /unsupported/);
  await assert.rejects(() => provider.complete({ systemPrompt: '', userMessage: 'something else', formatSchema: {} }), (/** @type {any} */ err) => {
    assert.equal(/** @type {any} */ (err).code, 'SCRIPT_EXHAUSTED');
    return true;
  });
  /** @type {any} */ (provider).respondWith({ kind: 'unsupported', reason: 'queued', reasoningSummary: 'x' });
  const queued = await provider.complete({ systemPrompt: '', userMessage: 'anything', formatSchema: {} });
  assert.equal(JSON.parse(queued.text).reason, 'queued');
});
