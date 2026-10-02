/**
 * Provider protocol tests — the JSON-envelope protocol and the native tool-call protocol
 * (synthetic runtime fixtures only; no model is executed).
 *
 * @module tests/provider-tools
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createOllamaProvider, toolCallToEnvelope, toolsFromDefinitions } from '../src/models/ollama-provider.mjs';

/**
 * @param {(body: any, res: import('node:http').ServerResponse) => void} handler
 */
function engine(handler) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      handler(JSON.parse(body), res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const SCHEMA = { type: 'object', required: ['kind'] };
const TOOLS = toolsFromDefinitions([
  { name: 'customer.search', description: 'find a customer', parameters: { type: 'object', properties: { query: { type: 'string' } } } }
]);

test('native toolCallMode sends tools, omits format, and maps the call to the envelope', async () => {
  let received = /** @type {any} */ (null);
  const { server, url } = await engine((body, res) => {
    received = body;
    res.end(JSON.stringify({
      message: { content: '', tool_calls: [{ function: { name: 'customer.search', arguments: { query: 'Acme' } } }] },
      done_reason: 'stop',
      prompt_eval_count: 100,
      prompt_eval_duration: 1_000_000_000,
      eval_count: 5,
      eval_duration: 500_000_000,
      load_duration: 2_000_000_000
    }));
  });
  try {
    const provider = createOllamaProvider({ baseUrl: url, model: 'm', toolCallMode: 'native' });
    const result = await provider.complete({ systemPrompt: 's', userMessage: 'u', formatSchema: SCHEMA, tools: TOOLS });
    assert.ok(Array.isArray(received.tools) && received.tools.length === 1, 'tools payload is sent');
    assert.equal(received.format, undefined, 'format schema is not sent in native mode');
    assert.equal(received.tools[0].function.name, 'customer.search');
    const envelope = JSON.parse(result.text);
    assert.equal(envelope.kind, 'proposal');
    assert.equal(envelope.capability, 'customer.search');
    assert.deepEqual(envelope.arguments, { query: 'Acme' });
    assert.equal(result.meta.toolCallMode, 'native');
    assert.equal(result.meta.toolCalls, 1);
    assert.equal(result.meta.promptEvalCount, 100);
    assert.equal(result.meta.evalCount, 5);
    assert.equal(result.meta.promptEvalTokensPerSecond, 100);
    assert.equal(result.meta.evalTokensPerSecond, 10);
  } finally {
    server.close();
  }
});

test('json toolCallMode is unchanged: format is sent, tools are not', async () => {
  let received = /** @type {any} */ (null);
  const { server, url } = await engine((body, res) => {
    received = body;
    res.end(JSON.stringify({ message: { content: '{"kind":"unsupported","reason":"x","reasoningSummary":"y"}' }, done_reason: 'stop' }));
  });
  try {
    const provider = createOllamaProvider({ baseUrl: url, model: 'm' });
    const result = await provider.complete({ systemPrompt: 's', userMessage: 'u', formatSchema: SCHEMA, tools: TOOLS });
    assert.deepEqual(received.format, SCHEMA);
    assert.equal(received.tools, undefined);
    assert.equal(result.meta.toolCallMode, 'json');
    assert.equal(result.text.includes('unsupported'), true);
  } finally {
    server.close();
  }
});

test('native clarification and unsupported pseudo-tools map to their envelopes', () => {
  const clarification = /** @type {any} */ (toolCallToEnvelope({ function: { name: 'clarification', arguments: '{"question":"Which one?"}' } }));
  assert.equal(clarification.kind, 'clarification');
  assert.equal(clarification.question, 'Which one?');
  const unsupported = /** @type {any} */ (toolCallToEnvelope({ function: { name: 'unsupported', arguments: { reason: 'no tool' } } }));
  assert.equal(unsupported.kind, 'unsupported');
  assert.equal(unsupported.reason, 'no tool');
  assert.equal(toolCallToEnvelope({ function: { name: '' } }), null);
  assert.equal(toolCallToEnvelope({ function: { name: 'x', arguments: 'not-json' } }), null);
});

test('native mode fails closed without tools, and an unmappable call is a typed failure', async () => {
  const { server, url } = await engine((body, res) => {
    res.end(JSON.stringify({ message: { content: '', tool_calls: [{ function: { arguments: {} } }] }, done_reason: 'stop' }));
  });
  try {
    const noTools = createOllamaProvider({ baseUrl: url, model: 'm', toolCallMode: 'native' });
    await assert.rejects(
      () => noTools.complete({ systemPrompt: 's', userMessage: 'u' }),
      (/** @type {any} */ err) => err.code === 'PROVIDER_NOT_CONFIGURED'
    );
    const provider = createOllamaProvider({ baseUrl: url, model: 'm', toolCallMode: 'native' });
    await assert.rejects(
      () => provider.complete({ systemPrompt: 's', userMessage: 'u', tools: TOOLS }),
      (/** @type {any} */ err) => err.code === 'PROVIDER_BAD_RESPONSE'
    );
  } finally {
    server.close();
  }
});

test('multiple native tool calls fail closed — never first-call selection', async () => {
  const { server, url } = await engine((body, res) => {
    res.end(JSON.stringify({
      message: {
        content: '',
        tool_calls: [
          { function: { name: 'customer.search', arguments: { query: 'a' } } },
          { function: { name: 'customer.create', arguments: { name: 'b' } } }
        ]
      },
      done_reason: 'stop'
    }));
  });
  try {
    const provider = createOllamaProvider({ baseUrl: url, model: 'm', toolCallMode: 'native' });
    await assert.rejects(
      () => provider.complete({ systemPrompt: 's', userMessage: 'u', tools: TOOLS }),
      (/** @type {any} */ err) => err.code === 'PROVIDER_BAD_RESPONSE' && /2 tool calls/.test(err.message) && err.detail?.toolCalls === 2
    );
  } finally {
    server.close();
  }
});

test('malformed native argument shapes are rejected, never normalized', () => {
  assert.equal(toolCallToEnvelope({ function: { name: 'x' } }), null);
  assert.equal(toolCallToEnvelope({ function: { name: 'x', arguments: null } }), null);
  assert.equal(toolCallToEnvelope({ function: { name: 'x', arguments: [] } }), null);
  assert.equal(toolCallToEnvelope({ function: { name: 'x', arguments: 5 } }), null);
  assert.equal(toolCallToEnvelope({ function: { name: 'x', arguments: 'not-json' } }), null);
  assert.equal(toolCallToEnvelope({ function: { name: 'x', arguments: '[]' } }), null);
  const empty = /** @type {any} */ (toolCallToEnvelope({ function: { name: 'x', arguments: '{}' } }));
  assert.equal(empty.kind, 'proposal');
  assert.deepEqual(empty.arguments, {});
});

test('an invalid toolCallMode is refused at construction', () => {
  assert.throws(
    () => createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'm', toolCallMode: 'sometimes' }),
    /toolCallMode/
  );
});
