/**
 * llama-server provider tests.
 *
 * Coverage is deliberately split:
 *  - the OpenAI-compatible request contract, normalization and typed errors are tested here against
 *    a loopback fixture server (deterministic, no model);
 *  - configuration gates (missing executable/artifact, non-loopback) are tested here;
 *  - the crash-during-startup path is tested here using an inert script as the "engine";
 *  - the full spawn → health → infer → kill lifecycle against the real engine is exercised by
 *    `scripts/probe-llama-server.mjs`, whose output is recorded in docs/LIVE_MODEL_VALIDATION.md.
 * The last item is stated rather than faked: there is no simulated engine in this suite.
 *
 * @module tests/llama-provider
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createLlamaServerProvider } from '../src/models/llama-server-provider.mjs';
import { createProvider } from '../src/models/provider.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { startLocalServer } from './helpers/fixtures.mjs';

const FAKE_ENGINE = join(process.cwd(), 'tests', 'helpers', 'fake-engine.mjs');

test('configuration gates: executable and artifact must exist, and the host must be loopback', async () => {
  assert.throws(
    () => createLlamaServerProvider({ executable: 'E:\\nope\\llama-server.exe', modelPath: FAKE_ENGINE }),
    /executable not found/
  );
  assert.throws(
    () => createLlamaServerProvider({ executable: process.execPath, modelPath: 'E:\\nope\\model.gguf' }),
    /model artifact not found/
  );
  assert.throws(
    () => createLlamaServerProvider({ executable: process.execPath, modelPath: FAKE_ENGINE, manageServer: false, baseUrl: 'http://example.com:8080' }),
    /not loopback/
  );
});

test('a configured llama-server provider is refused unless its executable and artifact exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sah-live-cfg-'));
  try {
    await mkdir(join(dir, 'config'), { recursive: true });
    const base = JSON.parse(
      await (await import('node:fs/promises')).readFile(join(process.cwd(), 'config', 'harness.live-230m.json'), 'utf8')
    );
    base.provider.executable = 'E:\\definitely\\missing\\llama-server.exe';
    const file = join(dir, 'config', 'harness.config.json');
    await writeFile(file, JSON.stringify(base), 'utf8');
    assert.throws(() => loadConfig(file), /provider\.executable does not exist/);

    base.provider.executable = 'E:\\llama-cpp\\llama-server.exe';
    base.provider.modelPath = 'E:\\models\\missing-artifact.gguf';
    await writeFile(file, JSON.stringify(base), 'utf8');
    assert.throws(() => loadConfig(file), /provider\.modelPath does not exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an engine that exits during startup is a typed failure with no process left behind', async () => {
  const provider = createLlamaServerProvider({
    executable: process.execPath,
    modelPath: FAKE_ENGINE,
    port: 0,
    startupTimeoutMs: 8000
  });
  await assert.rejects(() => provider.complete({ systemPrompt: 's', userMessage: 'u', formatSchema: { type: 'object' } }), (/** @type {any} */ err) => {
    assert.equal(/** @type {any} */ (err).code, 'PROVIDER_UNAVAILABLE');
    assert.match(String(/** @type {any} */ (err).message), /exited during startup|not become healthy/);
    return true;
  });
  assert.equal(provider.pid(), undefined, 'no child is retained after a failed start');
});

test('the request uses the OpenAI-compatible contract with schema-constrained output', async () => {
  /** @type {any} */
  let seen = null;
  const server = await startLocalServer((req, res) => {
    let raw = '';
    req.on('data', (/** @type {any} */ chunk) => {
      raw += String(chunk);
    });
    req.on('end', () => {
      if (req.url === '/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'LFM2.5-230M-Q8_0.gguf' }] }));
        return;
      }
      seen = JSON.parse(raw);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '{"kind":"unsupported","reason":"no","reasoningSummary":"x"}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 812, completion_tokens: 27 },
          timings: { prompt_ms: 1200, predicted_ms: 900 }
        })
      );
    });
  });
  try {
    const provider = createLlamaServerProvider({
      executable: process.execPath,
      modelPath: FAKE_ENGINE,
      manageServer: false,
      baseUrl: server.url,
      temperature: 0.1,
      topK: 50,
      repeatPenalty: 1.05,
      maxTokens: 512
    });
    const result = await provider.complete({
      systemPrompt: 'system rules',
      userMessage: 'do the thing',
      formatSchema: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string' } } }
    });
    assert.match(result.text, /unsupported/);
    assert.equal(result.meta.promptTokens, 812);
    assert.equal(result.meta.completionTokens, 27);
    assert.equal(result.meta.promptEvalMs, 1200);
    assert.equal(result.meta.provider, 'llama-server');

    assert.equal(seen.model, 'LFM2.5-230M-Q8_0.gguf', 'the engine-reported model id is used');
    assert.equal(seen.stream, false);
    assert.equal(seen.temperature, 0.1);
    assert.equal(seen.top_k, 50);
    assert.equal(seen.repeat_penalty, 1.05);
    assert.equal(seen.max_tokens, 512);
    assert.equal(seen.response_format.type, 'json_schema');
    assert.equal(seen.response_format.json_schema.strict, true);
    assert.equal(seen.response_format.json_schema.schema.required[0], 'kind');
  } finally {
    await server.close();
  }
});

test('an unreachable engine and an HTTP error are distinct typed failures', async () => {
  const unreachable = createLlamaServerProvider({
    executable: process.execPath,
    modelPath: FAKE_ENGINE,
    manageServer: false,
    baseUrl: 'http://127.0.0.1:1'
  });
  await assert.rejects(() => unreachable.complete({ systemPrompt: 's', userMessage: 'u', formatSchema: {} }), (/** @type {any} */ err) => {
    assert.equal(/** @type {any} */ (err).code, 'PROVIDER_UNAVAILABLE');
    return true;
  });

  const server = await startLocalServer((req, res) => {
    if (req.url === '/health') {
      res.end('ok');
      return;
    }
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'unsupported response_format' }));
  });
  try {
    const failing = createLlamaServerProvider({
      executable: process.execPath,
      modelPath: FAKE_ENGINE,
      manageServer: false,
      baseUrl: server.url
    });
    await assert.rejects(() => failing.complete({ systemPrompt: 's', userMessage: 'u', formatSchema: {} }), (/** @type {any} */ err) => {
      assert.equal(/** @type {any} */ (err).code, 'PROVIDER_HTTP_ERROR');
      assert.match(String(/** @type {any} */ (err).message), /unsupported response_format/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('the provider factory accepts the llama-server kind and keeps the other kinds intact', () => {
  const provider = createProvider({
    kind: 'llama-server',
    executable: process.execPath,
    modelPath: FAKE_ENGINE,
    manageServer: false,
    baseUrl: 'http://127.0.0.1:8095',
    temperature: 0.1,
    numCtx: 4096
  });
  assert.equal(provider.kind, 'llama-server');
  assert.equal(typeof provider.complete, 'function');
  assert.equal(typeof provider.stop, 'function');

  const scripted = createProvider({ kind: 'scripted', model: 'x', baseUrl: 'http://127.0.0.1:1' });
  assert.equal(scripted.kind, 'scripted');
});
