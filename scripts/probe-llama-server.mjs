#!/usr/bin/env node
/**
 * Live engine probe — runtime evidence, not documentation.
 *
 * Spawns the verified local engine (llama-server, build 9940) on a dedicated loopback port,
 * waits for health, runs two isolated probes, then kills the engine it started and verifies the
 * process is gone.
 *
 *   Probe A — structured proposal output: does this build + this artifact emit a schema-valid
 *             proposal envelope, and how often does it fail?
 *   Probe B — native tool calling: does this build emit a well-formed tool call at all?
 *
 * Results are printed as JSON and written under benchmarks/results/live/. The probe owns its
 * process: it never touches another workflow's engine, and it leaves nothing running.
 *
 * Usage: node scripts/probe-llama-server.mjs [--port 8096] [--iterations 5] [--no-tools-flag]
 *
 * @module scripts/probe-llama-server
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENVELOPE_SCHEMA, ENVELOPE_FORMAT_SCHEMA } from '../src/models/prompt.mjs';
import { parseEnvelope } from '../src/models/response-parser.mjs';
import { validate } from '../src/core/schema.mjs';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : String(argv[index + 1] ?? fallback);
};
const PORT = Number.parseInt(arg('--port', '8096'), 10);
const ITERATIONS = Number.parseInt(arg('--iterations', '5'), 10);
const USE_JINJA = !argv.includes('--no-tools-flag');

const liveConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'config/harness.live-230m.json'), 'utf8'));
const EXECUTABLE = String(liveConfig.provider.executable);
const MODEL_PATH = String(liveConfig.provider.modelPath);
const BASE = `http://127.0.0.1:${PORT}`;

for (const [label, path] of [['executable', EXECUTABLE], ['model', MODEL_PATH]]) {
  if (!existsSync(path)) {
    process.stderr.write(`probe: ${label} not found: ${path}\n`);
    process.exit(2);
  }
}

/** @type {Array<{ text: string, capability: string|null, arguments: Record<string, unknown>|null }>} */
const PROBE_PROMPTS = [
  { text: 'do we have a customer called Smith?', capability: 'customer.search', arguments: { query: 'Smith' } },
  { text: 'create a customer named Acme Electrical', capability: 'customer.create', arguments: { name: 'Acme Electrical' } },
  { text: 'issue invoice INV-0004', capability: 'invoice.issue', arguments: { invoiceId: 'INV-0004' } },
  { text: 'what is on the ledger?', capability: 'ledger.query', arguments: { limit: 5 } },
  { text: 'transfer $20,000 to this bank account', capability: null, arguments: null }
];

/** @type {import('node:child_process').ChildProcess|null} */
let child = null;
const evidence = {
  probe: 'llama-server-live',
  at: new Date().toISOString(),
  runtime: { executable: EXECUTABLE, port: PORT, build: null, jinja: USE_JINJA, args: /** @type {string[]} */ ([]) },
  model: { path: MODEL_PATH, id: null },
  probeA: { status: 'NOT_RUN', iterations: [], summary: {} },
  probeB: { status: 'NOT_RUN', iterations: [], summary: {} },
  teardown: { killed: false, processGone: false }
};

try {
  await startEngine();
  await probeA();
  await probeB();
} catch (err) {
  process.stderr.write(`probe: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  evidence.probeA.status = evidence.probeA.status === 'NOT_RUN' ? 'ERROR' : evidence.probeA.status;
} finally {
  await stopEngine();
}

const dir = resolve(process.cwd(), 'benchmarks', 'results', 'live');
mkdirSync(dir, { recursive: true });
const out = resolve(dir, `probe-${evidence.at.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`\nprobe written: ${out}\n`);
process.exit(evidence.probeA.status === 'SUPPORTED' || evidence.probeA.status === 'PARTIALLY_SUPPORTED' ? 0 : 1);

// ---------------------------------------------------------------------------- engine

async function startEngine() {
  const args = [
    '-m',
    MODEL_PATH,
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--ctx-size',
    '4096',
    '--threads',
    '4',
    '--parallel',
    '1',
    '--no-warmup',
    ...(USE_JINJA ? ['--jinja'] : [])
  ];
  evidence.runtime.args = args.map((value) => (value === MODEL_PATH ? '<model>' : value));
  const startedAt = Date.now();
  child = spawn(EXECUTABLE, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  const deadline = startedAt + 120000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('engine did not become healthy within 120 s');
    if (child.exitCode !== null) throw new Error(`engine exited during startup (code ${child.exitCode})`);
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  evidence.runtime.startupMs = Date.now() - startedAt;
  const versionRes = await fetch(`${BASE}/props`).catch(() => null);
  if (versionRes && versionRes.ok) {
    const props = await versionRes.json().catch(() => ({}));
    evidence.runtime.build = props?.build_info ?? null;
    evidence.model.id = props?.model_path ?? null;
  }
  const models = await fetch(`${BASE}/v1/models`).then((r) => r.json()).catch(() => null);
  evidence.model.servedId = models?.data?.[0]?.id ?? null;
}

async function stopEngine() {
  if (!child || child.pid === undefined) return;
  const pid = child.pid;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  const deadline = Date.now() + 8000;
  for (;;) {
    if (processGone(pid)) break;
    if (Date.now() > deadline) break;
    await sleep(200);
  }
  evidence.teardown.killed = true;
  evidence.teardown.processGone = processGone(pid);
  child = null;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function processGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------- probes

async function probeA() {
  const results = [];
  for (let i = 0; i < Math.min(ITERATIONS, PROBE_PROMPTS.length); i += 1) {
    const prompt = PROBE_PROMPTS[i];
    const started = Date.now();
    const completion = await chat(
      {
        messages: [
          { role: 'system', content: 'You are a capability-selection component. Reply with exactly one JSON object and nothing else.' },
          { role: 'user', content: prompt.text }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'proposal', strict: true, schema: ENVELOPE_FORMAT_SCHEMA } },
        max_tokens: 512
      },
      /** @type {any} */ ({})
    );
    const latencyMs = Date.now() - started;
    const text = completion.text;
    /** @type {any} */
    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    let envelopeOk = false;
    let envelopeError = null;
    try {
      parseEnvelope(text);
      envelopeOk = true;
    } catch (err) {
      envelopeError = err instanceof Error ? err.message : String(err);
    }
    const schemaIssues = parsed === null ? [] : validate(parsed, /** @type {Record<string, unknown>} */ (ENVELOPE_SCHEMA)).map((issue) => `${issue.path} ${issue.keyword}`);
    const unknownFields = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed).filter((key) => !['kind', 'reasoningSummary', 'proposalId', 'capability', 'arguments', 'question', 'reason'].includes(key))
      : [];
    results.push({
      prompt: prompt.text,
      expectedCapability: prompt.capability,
      parseOk: parseError === null,
      parseError,
      envelopeOk,
      envelopeError,
      schemaIssueCount: schemaIssues.length,
      unknownFields,
      kind: parsed?.kind ?? null,
      capability: parsed?.capability ?? null,
      capabilityMatches: prompt.capability === null ? parsed?.kind === 'unsupported' : parsed?.capability === prompt.capability,
      latencyMs,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      raw: text.slice(0, 400)
    });
  }
  const parseOk = results.filter((r) => r.parseOk).length;
  const envelopeOk = results.filter((r) => r.envelopeOk).length;
  const matches = results.filter((r) => r.capabilityMatches).length;
  const extra = results.filter((r) => r.unknownFields.length > 0).length;
  evidence.probeA.iterations = results;
  evidence.probeA.summary = {
    iterations: results.length,
    parseOk,
    envelopeOk,
    capabilityMatches: matches,
    unknownFieldResponses: extra,
    malformedRate: results.length === 0 ? null : Number((1 - parseOk / results.length).toFixed(3))
  };
  evidence.probeA.status = parseOk === results.length && envelopeOk === results.length ? 'SUPPORTED' : parseOk > 0 ? 'PARTIALLY_SUPPORTED' : 'UNSUPPORTED';
}

async function probeB() {
  const tool = {
    type: 'function',
    function: {
      name: 'customer_search',
      description: 'Search existing customer records by name or email.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: { query: { type: 'string' } }
      }
    }
  };
  const results = [];
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    const response = await rawChat({
      messages: [
        { role: 'system', content: 'You are a tool-using assistant. Use a tool when it is the right way to answer.' },
        { role: 'user', content: 'do we have a customer called Smith?' }
      ],
      tools: [tool],
      tool_choice: 'auto',
      max_tokens: 256
    });
    results.push({
      iteration: i + 1,
      httpStatus: response.status,
      hasToolCalls: Array.isArray(response.body?.choices?.[0]?.message?.tool_calls) && response.body.choices[0].message.tool_calls.length > 0,
      toolCallShape: summariseToolCalls(response.body?.choices?.[0]?.message?.tool_calls),
      contentPreview: typeof response.body?.choices?.[0]?.message?.content === 'string' ? response.body.choices[0].message.content.slice(0, 200) : null,
      error: response.body?.error ?? null,
      latencyMs: Date.now() - started
    });
  }
  const withCalls = results.filter((r) => r.hasToolCalls).length;
  const wellFormed = results.filter((r) => r.toolCallShape?.argumentsParseOk === true).length;
  evidence.probeB.iterations = results;
  evidence.probeB.summary = { iterations: results.length, toolCallResponses: withCalls, wellFormedArguments: wellFormed };
  evidence.probeB.status =
    withCalls === results.length && wellFormed === results.length
      ? 'SUPPORTED'
      : withCalls > 0
        ? 'PARTIALLY_SUPPORTED'
        : 'UNSUPPORTED';
}

/**
 * @param {unknown} toolCalls
 */
function summariseToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const first = toolCalls[0];
  const rawArguments = first?.function?.arguments;
  let argumentsParseOk = false;
  let parsed = null;
  if (typeof rawArguments === 'string') {
    try {
      parsed = JSON.parse(rawArguments);
      argumentsParseOk = parsed !== null && typeof parsed === 'object';
    } catch {
      argumentsParseOk = false;
    }
  } else if (rawArguments !== null && typeof rawArguments === 'object') {
    parsed = rawArguments;
    argumentsParseOk = true;
  }
  return { name: first?.function?.name ?? null, argumentsType: typeof rawArguments, argumentsParseOk, parsed };
}

/**
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} extra
 */
async function chat(body, extra) {
  const response = await rawChat({ ...body, ...extra, temperature: 0.1, top_k: 50, repeat_penalty: 1.05, stream: false });
  const choice = response.body?.choices?.[0];
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    promptTokens: response.body?.usage?.prompt_tokens ?? null,
    completionTokens: response.body?.usage?.completion_tokens ?? null
  };
}

/**
 * @param {Record<string, unknown>} body
 */
async function rawChat(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    /** @type {any} */
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text.slice(0, 300) };
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
