#!/usr/bin/env node
/**
 * Live-model benchmark — real inference through the verified local engine.
 *
 * This is a separate truth from the deterministic fixture benchmark:
 *   benchmarks/run-benchmark.mjs       → harness correctness (fixture replay, no inference)
 *   benchmarks/run-live-benchmark.mjs  → model capability under the harness (real inference)
 * The two numbers are never combined (docs/BENCHMARK.md).
 *
 * One engine is spawned for the whole run and reused by every case, so model load time is paid
 * once and reported separately. Each case gets a fresh harness (fresh synthetic state) so cases
 * cannot contaminate one another, while authority, policy, permits and verification are exactly
 * the production ones.
 *
 * Arms (directive §5):
 *   A  full bounded harness (contract + SOP + bounded context)
 *   B  A + overloaded capability context (no domain filter, cap 32, plus filler capabilities)
 *   C  A with minimal guidance (no contract, no SOP; capability context and response contract only)
 * C exists only to measure the contribution of the harness's guidance. Authority is identical in
 * all three arms — the harness must contain a bad model in every case.
 *
 * Usage:
 *   node benchmarks/run-live-benchmark.mjs --arm A --reps 3 [--only B01,B12] [--port 8097]
 *
 * @module benchmarks/run-live-benchmark
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createHarnessFromConfig } from '../src/bootstrap.mjs';
import { createLlamaServerProvider } from '../src/models/llama-server-provider.mjs';
import { STATUS } from '../src/harness.mjs';
import { EVENT } from '../src/evidence/journal.mjs';

const argv = process.argv.slice(2);
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : String(argv[index + 1] ?? fallback);
};
const ARM = (arg('--arm', 'A') || 'A').toUpperCase();
const REPS = Number.parseInt(arg('--reps', '3'), 10);
const PORT = Number.parseInt(arg('--port', '8097'), 10);
const CONFIG_PATH = resolve(process.cwd(), arg('--config', 'config/harness.live-230m.json'));
const ONLY = arg('--only', '');
const FIXTURE = resolve(process.cwd(), 'benchmarks/prompts.jsonl');
const RESULTS_DIR = resolve(process.cwd(), 'benchmarks', 'results', 'live');

if (!['A', 'B', 'C'].includes(ARM)) {
  process.stderr.write(`unknown arm ${ARM}; expected A, B or C\n`);
  process.exit(3);
}

const liveConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const THREADS = Number.parseInt(arg('--threads', String(liveConfig.provider.threads ?? 4)), 10);
const MAX_TOKENS = Number.parseInt(arg('--max-tokens', String(liveConfig.provider.maxTokens ?? 512)), 10);
const fixture = loadFixture();
const selected = ONLY ? fixture.filter((entry) => ONLY.split(',').includes(String(entry.id))) : fixture;
const fixtureHash = sha256(readFileSync(FIXTURE, 'utf8'));

// One engine for the whole run; the provider owns it and kills it.
const engine = createLlamaServerProvider({
  executable: String(liveConfig.provider.executable),
  modelPath: String(liveConfig.provider.modelPath),
  manageServer: true,
  port: PORT,
  ctxSize: Number(liveConfig.provider.numCtx ?? 4096),
  threads: THREADS,
  startupTimeoutMs: 120000,
  inferenceTimeoutMs: 120000,
  temperature: Number(liveConfig.provider.temperature ?? 0.1),
  topK: Number(liveConfig.provider.topK ?? 50),
  repeatPenalty: Number(liveConfig.provider.repeatPenalty ?? 1.05),
  maxTokens: MAX_TOKENS,
  structuredMode: String(liveConfig.provider.structuredMode ?? 'json_schema')
});

/** Consumption records, captured by wrapping the provider (no production change). */
/** @type {Array<Record<string, unknown>>} */
const calls = [];
const wrappedProvider = {
  kind: engine.kind,
  model: engine.model,
  async complete(/** @type {any} */ request) {
    const started = Date.now();
    const result = await engine.complete(request);
    calls.push({ at: Date.now(), wallMs: Date.now() - started, ...result.meta });
    return result;
  },
  stop: () => /** @type {any} */ (engine).stop()
};

const report = /** @type {any} */ ({
  benchmark: 'live-model',
  arm: ARM,
  at: new Date().toISOString(),
  command: `node benchmarks/run-live-benchmark.mjs ${argv.join(' ')}`.trim(),
  harness: { commit: gitHead(), configHash: null, registryHash: null, sopHash: null, promptMode: ARM === 'C' ? 'minimal' : 'full' },
  runtime: { executable: String(liveConfig.provider.executable), port: PORT, startupMs: null, modelId: null, build: null },
  model: { path: String(liveConfig.provider.modelPath), sha256: null, sizeBytes: null, quantization: 'Q8_0' },
  sampling: {
    temperature: Number(liveConfig.provider.temperature ?? 0.1),
    topK: Number(liveConfig.provider.topK ?? 50),
    repeatPenalty: Number(liveConfig.provider.repeatPenalty ?? 1.05),
    maxTokens: MAX_TOKENS,
    ctxSize: Number(liveConfig.provider.numCtx ?? 4096),
    threads: THREADS,
    structuredMode: String(liveConfig.provider.structuredMode ?? 'json_schema'),
    note: 'local inference is not bit-reproducible; temperature/seed reduce but do not remove variance (research R-28/R-50)'
  },
  fixture: { path: 'benchmarks/prompts.jsonl', hash: fixtureHash, cases: fixture.length, selected: selected.length },
  repetitions: REPS,
  arms: {
    A: 'full bounded harness',
    B: 'overloaded capability context (+filler)',
    C: 'minimal guidance (no contract, no SOP; authority unchanged)'
  },
  modelMetrics: {},
  harnessMetrics: { unauthorizedExecutions: 0, falseVerified: 0, capabilityNotExposedExecutions: 0 },
  distribution: {},
  unmeasured: [
    'pass^k reliability across machines',
    'VRAM use (CPU-only run path)',
    'model-quality comparison against a different model family'
  ],
  cases: []
});

try {
  await engine.ensureStarted();
  const health = await engine.health();
  report.runtime.startupMs = health.loadMs ?? null;
  report.runtime.modelId = health.modelId ?? null;
  Object.assign(report.model, await modelIdentity(String(liveConfig.provider.modelPath)));

  for (let rep = 1; rep <= REPS; rep += 1) {
    for (const testCase of selected) {
      const caseResult = await runCase(testCase, rep);
      report.cases.push(caseResult);
    }
    process.stdout.write(`arm ${ARM}: repetition ${rep}/${REPS} complete (${report.cases.length} case-runs so far)\n`);
  }
} finally {
  await /** @type {any} */ (engine).stop();
}

aggregate();
const dir = resolve(RESULTS_DIR);
await mkdir(dir, { recursive: true });
const out = resolve(dir, `live-${ARM.toLowerCase()}-${report.at.replace(/[:.]/g, '-')}.json`);
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${renderSummary(report)}\n`);
process.stdout.write(`report: ${out}\n`);
process.exit(0);

/**
 * @param {any} testCase
 * @param {number} rep
 */
async function runCase(testCase, rep) {
  const bundle = await createHarnessFromConfig({
    configPath: CONFIG_PATH,
    provider: /** @type {any} */ (wrappedProvider),
    includeContextText: true,
    ...(ARM === 'C' ? { promptMode: 'minimal' } : {}),
    ...(ARM === 'B'
      ? {
          mutateConfig: (/** @type {any} */ config) => {
            config.exposure.domains = [];
            config.exposure.maxCapabilities = 32;
          },
          extraCapabilities: fillerCapabilities(40)
        }
      : {})
  });
  report.harness.configHash = bundle.configHash;
  report.harness.registryHash = bundle.registry.hash();
  report.harness.sopHash = bundle.sop.hash;

  /** @type {any[]} */
  const turns = [];
  for (const turn of testCase.turns) {
    const started = Date.now();
    const result =
      typeof turn.user === 'string'
        ? await bundle.harness.handleUserMessage(turn.user)
        : await bundle.harness.confirm(String(turn.confirm));
    const events = await bundle.journal.read(120);
    const runEvents = events.filter((/** @type {any} */ event) => event.runId === result.runId);
    const proposed = runEvents.find((/** @type {any} */ event) => event.type === EVENT.PROPOSED);
    const rejected = runEvents.find((/** @type {any} */ event) => event.type === EVENT.PROPOSAL_REJECTED);
    const contextEvent = runEvents.find((/** @type {any} */ event) => event.type === EVENT.CAPABILITIES_EXPOSED);
    const executed = runEvents.some(
      (/** @type {any} */ event) => event.type === EVENT.EXECUTION_STARTED || event.type === EVENT.EXECUTION_SUCCEEDED
    );
    const authorized = runEvents.some((/** @type {any} */ event) => event.type === EVENT.AUTHORIZED);
    const consumed = runEvents.some((/** @type {any} */ event) => event.type === EVENT.AUTHORITY_CONSUMED);
    const exposed = Array.isArray(contextEvent?.data?.exposed) ? contextEvent.data.exposed : [];
    const authorization = !executed
      ? 'NOT_EXECUTED'
      : authorized && consumed && (result.capability === null || exposed.includes(result.capability))
        ? 'AUTHORIZED_IN_SNAPSHOT'
        : !authorized || !consumed
          ? 'MISSING_BUT_EXECUTED'
          : 'OUTSIDE_SNAPSHOT';
    const reference = turn.model && typeof turn.model === 'object' ? turn.model : null;
    const actualArgs = proposed ? /** @type {any} */ (result.proposal?.arguments) : null;
    const referenceArgs = reference?.arguments ?? null;

    turns.push({
      input: turn.user ?? `confirm: ${turn.confirm}`,
      wallMs: Date.now() - started,
      authorization,
      expected: turn.expect ?? null,
      actual: {
        status: result.status,
        capability: result.capability,
        risk: result.risk,
        executed,
        verified: result.status === STATUS.EXECUTED_VERIFIED,
        message: String(result.message).slice(0, 240)
      },
      matched: matchesExpectation(turn.expect ?? {}, result, executed),
      modelSignals: {
        proposalPresent: Boolean(proposed),
        parseOrValidationRejected: Boolean(rejected),
        rejectionCode: rejected?.data?.code ?? null,
        capabilitySelected: result.capability,
        argumentsSupplied: actualArgs,
        argumentsMatchReference: referenceArgs && actualArgs ? sameArguments(actualArgs, referenceArgs) : null,
        inventedArgumentKeys: referenceArgs && actualArgs ? Object.keys(actualArgs).filter((key) => !(key in referenceArgs)) : [],
        missingReferenceKeys: referenceArgs && actualArgs ? Object.keys(referenceArgs).filter((key) => !(key in actualArgs)) : [],
        clarificationAsked: result.status === STATUS.CLARIFICATION_REQUIRED,
        unsupportedDeclared: result.status === STATUS.UNSUPPORTED
      },
      contextBudget: contextEvent?.data?.budget ?? null
    });
  }

  const passed = turns.every((/** @type {any} */ turn) => turn.matched);
  return { id: testCase.id, category: testCase.category, repetition: rep, passed, turns };
}

/**
 * @param {Record<string, unknown>} expectation
 * @param {any} result
 * @param {boolean} executed
 */
function matchesExpectation(expectation, result, executed) {
  if (expectation.status !== undefined && result.status !== expectation.status) return false;
  if (expectation.capability !== undefined && result.capability !== expectation.capability) return false;
  if (expectation.executed !== undefined && executed !== expectation.executed) return false;
  return true;
}

/**
 * @param {Record<string, unknown>} actual
 * @param {Record<string, unknown>} reference
 */
function sameArguments(actual, reference) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(reference)]);
  for (const key of keys) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(reference[key])) return false;
  }
  return true;
}

function aggregate() {
  const runs = report.cases;
  const turns = runs.flatMap((/** @type {any} */ run) => run.turns);
  const modelTurns = turns.filter((/** @type {any} */ turn) => !String(turn.input).startsWith('confirm:'));
  const count = (/** @type {(turn: any) => boolean} */ predicate) => modelTurns.filter(predicate).length;
  const withReference = modelTurns.filter((/** @type {any} */ turn) => turn.expected?.capability !== undefined);

  report.modelMetrics = {
    caseRuns: runs.length,
    casesPassed: runs.filter((/** @type {any} */ run) => run.passed).length,
    caseCompletionRate: runs.length === 0 ? null : round(runs.filter((/** @type {any} */ run) => run.passed).length / runs.length),
    turns: turns.length,
    modelTurns: modelTurns.length,
    capabilitySelectionCorrect: `${count((/** @type {any} */ t) => t.modelSignals.capabilitySelected === t.expected?.capability)}/${withReference.length}`,
    proposalPresent: `${count((/** @type {any} */ t) => t.modelSignals.proposalPresent)}/${modelTurns.length}`,
    schemaRejected: count((/** @type {any} */ t) => t.modelSignals.parseOrValidationRejected),
    argumentsMatchReference: `${modelTurns.filter((/** @type {any} */ t) => t.modelSignals.argumentsMatchReference === true).length}/${
      modelTurns.filter((/** @type {any} */ t) => t.modelSignals.argumentsMatchReference !== null).length
    }`,
    inventedArgumentKeys: modelTurns.filter((/** @type {any} */ t) => (t.modelSignals.inventedArgumentKeys ?? []).length > 0).length,
    hallucinations: count((/** @type {any} */ t) => t.modelSignals.rejectionCode === 'UNKNOWN_CAPABILITY' || t.modelSignals.rejectionCode === 'CAPABILITY_NOT_EXPOSED'),
    clarificationsAsked: count((/** @type {any} */ t) => t.modelSignals.clarificationAsked),
    unnecessaryClarifications: modelTurns.filter(
      (/** @type {any} */ t) => t.modelSignals.clarificationAsked && t.expected?.status !== STATUS.CLARIFICATION_REQUIRED
    ).length,
    unsupportedDeclared: count((/** @type {any} */ t) => t.modelSignals.unsupportedDeclared),
    intentPrecisionUnderOverload: ARM === 'B' ? 'see per-case context budget' : null
  };

  // Two different things, deliberately counted separately:
  //  - unexpectedExecutions: the model did something other than what the case expected. That is a
  //    MODEL signal, not a breach, when the capability it did run was authorised and verified.
  //  - unauthorizedExecutions: an execution that the harness should have prevented. Counted only
  //    when an execution happened without an AUTHORIZED + AUTHORITY_CONSUMED pair in the same run,
  //    or when the executed capability was not in that turn's capability snapshot.
  report.harnessMetrics.unexpectedExecutions = turns.filter(
    (/** @type {any} */ t) => t.expected?.executed === false && t.actual.executed
  ).length;
  report.harnessMetrics.unauthorizedExecutions = runs
    .flatMap((/** @type {any} */ run) => run.turns)
    .filter((/** @type {any} */ t) => t.authorization === 'MISSING_BUT_EXECUTED' || t.authorization === 'OUTSIDE_SNAPSHOT').length;
  report.harnessMetrics.falseVerified = turns.filter(
    (/** @type {any} */ t) => t.expected?.verified === false && t.actual.verified
  ).length;

  const latencies = calls.map((/** @type {any} */ call) => Number(call.wallMs)).filter((value) => Number.isFinite(value));
  const ctx = runs
    .flatMap((/** @type {any} */ run) => run.turns)
    .map((/** @type {any} */ turn) => turn.contextBudget)
    .filter(Boolean);
  report.distribution = {
    calls: calls.length,
    coldStartMs: report.runtime.startupMs,
    latencyMs: {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      max: latencies.length > 0 ? Math.max(...latencies) : null,
      mean: latencies.length > 0 ? round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length) : null
    },
    tokens: {
      prompt: sum(calls, 'promptTokens'),
      completion: sum(calls, 'completionTokens')
    },
    tokensPerSecond: round(
      (sum(calls, 'completionTokens') / Math.max(1, latencies.reduce((acc, v) => acc + v, 0) / 1000)) || 0
    ),
    promptEvalMsMean: mean(calls, 'promptEvalMs'),
    contextBudget: {
      meanCapabilities: mean(ctx.map((/** @type {any} */ b) => Number(b.capabilityCount))),
      meanApproxTokens: mean(ctx.map((/** @type {any} */ b) => Number(b.approxTokens))),
      maxApproxTokens: ctx.length > 0 ? Math.max(...ctx.map((/** @type {any} */ b) => Number(b.approxTokens))) : null
    },
    ramVram: 'NOT MEASURED (CPU inference path; no reliable per-process VRAM attribution attempted)'
  };
}

/**
 * @param {any[]} values
 */
function sum(/** @type {any[]} */ values, /** @type {string} */ key) {
  return values.reduce((acc, value) => acc + (typeof value[key] === 'number' ? value[key] : 0), 0);
}

/**
 * @param {any[]} values
 * @param {string|null} [key]
 */
function mean(values, key = null) {
  const numbers = values.map((value) => Number(key ? value[key] : value)).filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return round(numbers.reduce((acc, value) => acc + value, 0) / numbers.length);
}

/**
 * @param {number[]} values
 * @param {number} p
 */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** @param {number} value */
function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/**
 * @param {any} report
 */
function renderSummary(report) {
  const lines = [];
  lines.push(`live arm ${report.arm} — ${report.modelMetrics.caseRuns} case-runs, ${report.modelMetrics.caseCompletionRate} completion rate`);
  lines.push(`model: capability selection ${report.modelMetrics.capabilitySelectionCorrect} · proposals ${report.modelMetrics.proposalPresent} · arguments ${report.modelMetrics.argumentsMatchReference} · invented args ${report.modelMetrics.inventedArgumentKeys} · hallucinated ${report.modelMetrics.hallucinations} · clarifications ${report.modelMetrics.clarificationsAsked} (unnecessary ${report.modelMetrics.unnecessaryClarifications})`);
  lines.push(`harness: unauthorized executions ${report.harnessMetrics.unauthorizedExecutions} · false verified ${report.harnessMetrics.falseVerified} · executions of unexposed capabilities ${report.harnessMetrics.capabilityNotExposedExecutions}`);
  lines.push(`distribution: cold start ${report.distribution.coldStartMs} ms · p50 ${report.distribution.latencyMs.p50} ms · p95 ${report.distribution.latencyMs.p95} ms · ${report.distribution.tokensPerSecond} tok/s · context mean ${report.distribution.contextBudget.meanCapabilities} caps / ${report.distribution.contextBudget.meanApproxTokens} approx tokens`);
  return lines.join('\n');
}

function loadFixture() {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'))
    .map((line) => JSON.parse(line));
}

/**
 * Deterministic filler capabilities for arm B (identical set to the fixture benchmark).
 * @param {number} count
 */
function fillerCapabilities(count) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  const domains = ['inventory.ops', 'printing.ops', 'scheduling.ops', 'archiving.ops', 'telemetry.ops'];
  for (let i = 0; i < count; i += 1) {
    const domain = domains[i % domains.length];
    const domainKey = domain.split('.')[0];
    out.push({
      id: `${domainKey}.operation_${String(i + 1).padStart(3, '0')}`,
      version: 1,
      description: `Synthetic filler operation ${i + 1} used only to simulate an overloaded tool surface in benchmark arm measurements.`,
      whenToUse: 'Never: this operation exists only to measure context construction under overload.',
      whenNotToUse: 'Always: it has no adapter implementation and no verifier behaviour.',
      domain,
      risk: 'READ',
      outputSummary: 'Nothing; the operation is not implemented.',
      requiredPermissions: ['accounting.read'],
      requiresConfirmation: false,
      sideEffects: ['none'],
      relatedCapabilities: [],
      tags: ['filler', domainKey, 'irrelevant'],
      inputSchema: { type: 'object', additionalProperties: false, required: [], properties: { reference: { type: 'string', minLength: 1, maxLength: 40 } } },
      adapter: { kind: 'mock', operation: `${domainKey}.operation_${String(i + 1).padStart(3, '0')}` },
      verifier: 'read.matches_result'
    });
  }
  return out;
}

/**
 * @param {string} path
 */
async function modelIdentity(path) {
  const { statSync } = await import('node:fs');
  const { createHash: hasher } = await import('node:crypto');
  const stats = statSync(path);
  const digest = hasher('sha256');
  digest.update(readFileSync(path));
  return { sha256: digest.digest('hex'), sizeBytes: stats.size };
}

function gitHead() {
  try {
    const head = readFileSync(resolve(process.cwd(), '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) {
      return readFileSync(resolve(process.cwd(), '.git', head.slice(5)), 'utf8').trim();
    }
    return head;
  } catch {
    return 'unknown';
  }
}

/** @param {string} text */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
