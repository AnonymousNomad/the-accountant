#!/usr/bin/env node
/**
 * Benchmark runner.
 *
 * What this measures: the behaviour of the HARNESS and the CAPABILITY CONTEXT it constructs.
 * What it cannot measure: model quality. The scripted provider replays fixtures, so every
 * "model" column is identical between arms by construction. Reporting a difference in model
 * accuracy from this run would be fabrication (docs/BENCHMARK.md; research R-40..R-50).
 *
 * The arm experiment (addendum §12) still has a real, deterministic result: it shows exactly
 * how much context an overloaded capability surface injects versus a bounded, relevant one.
 * When Ollama is available, the same runner drives a real model arm and the model-dependent
 * columns become measurable — the code path is the same, only the provider changes.
 *
 * Usage:
 *   node benchmarks/run-benchmark.mjs [--arm bounded|overloaded] [--filler 40]
 *                                     [--only B12,B15] [--json] [--out <path>]
 *
 * @module benchmarks/run-benchmark
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createHarnessFromConfig } from '../src/bootstrap.mjs';
import { STATUS } from '../src/harness.mjs';
import { EVENT } from '../src/evidence/journal.mjs';
import { createClock } from '../src/core/util.mjs';

const FIXTURE_PATH = resolve(process.cwd(), 'benchmarks/prompts.jsonl');
const RESULTS_DIR = resolve(process.cwd(), 'benchmarks/results');

/** Fixture-authored failure classes (directive §15 taxonomy). No model judging is involved. */
export const FAILURE_TAXONOMY = Object.freeze([
  'MODEL_REASONING',
  'MODEL_SCHEMA',
  'PROMPT_SOP',
  'CONTEXT',
  'CAPABILITY_MISSING',
  'CAPABILITY_NOT_EXPOSED',
  'CAPABILITY_IRRELEVANT_EXPOSURE',
  'CAPABILITY_DESCRIPTION_AMBIGUOUS',
  'CAPABILITY_SELECTION_WRONG',
  'CAPABILITY_PREREQUISITE_MISSING',
  'CAPABILITY_PERMISSION_FILTER_ERROR',
  'CAPABILITY_CONTEXT_STALE',
  'ARGUMENT_SCHEMA',
  'AUTHORITY',
  'ADAPTER',
  'APPLICATION',
  'VERIFICATION',
  'TEST_DEFECT',
  'UNKNOWN'
]);

/** @type {Record<string, string|boolean>} */
const args = parseArgs(process.argv.slice(2));
const arm = args.arm === 'overloaded' ? 'overloaded' : 'bounded';
const fillerCount = arm === 'overloaded' ? Number.parseInt(String(args.filler ?? '40'), 10) : 0;
const fixture = await loadFixture();
const fixtureHash = sha256(await readFile(FIXTURE_PATH, 'utf8'));

const selected = args.only
  ? fixture.filter((c) => String(args.only).split(',').includes(String(c.id)))
  : fixture;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = resolve(RESULTS_DIR, `${stamp}-${arm}`);
await mkdir(runDir, { recursive: true });

/** @type {any} */
const report = {
  benchmarkVersion: '1',
  runAt: new Date().toISOString(),
  command: `node benchmarks/run-benchmark.mjs ${process.argv.slice(2).join(' ')}`.trim(),
  arm,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    machine: process.env.COMPUTERNAME ?? null
  },
  harness: {
    version: packageVersion(),
    registrySize: null,
    configHash: null,
    registryHash: null,
    sopHash: null,
    baseContractHash: null
  },
  provider: {
    kind: 'scripted',
    model: 'scripted-fixture',
    backend: 'fixture replay (no inference performed)',
    decodeParams: { temperature: 0, seed: 0 }
  },
  fixture: { path: 'benchmarks/prompts.jsonl', hash: fixtureHash, cases: fixture.length, selected: selected.length },
  contextBudget: {
    arm,
    fillerCapabilities: fillerCount,
    turnsMeasured: 0,
    meanCapabilities: 0,
    maxCapabilities: 0,
    minCapabilities: 0,
    meanTextChars: 0,
    meanApproxTokens: 0,
    maxApproxTokens: 0,
    totalSchemaBytes: 0
  },
  metrics: {
    expectationsChecked: 0,
    expectationsMet: 0,
    parseSuccess: { passed: 0, total: 0 },
    correctCapability: { passed: 0, total: 0 },
    argumentValidity: { passed: 0, total: 0 },
    clarificationDetected: { passed: 0, total: 0 },
    hallucinatedCapabilityRejected: { passed: 0, total: 0 },
    unauthorizedExecutions: 0,
    verificationResult: { passed: 0, total: 0 },
    endToEndCompletion: { passed: 0, total: selected.length },
    failuresByClassification: /** @type {Record<string, number>} */ ({})
  },
  latencyMs: { turns: 0, warmUpMs: null, p50: null, p90: null, p99: null, max: null, mean: null },
  unmeasured: [
    'model selection accuracy (scripted fixtures do not exercise a model)',
    'model argument correctness (fixtures supply arguments)',
    'model clarification behaviour (fixtures supply clarifications)',
    'model hallucination rate (fixtures supply the hallucination cases)',
    'pass^k reliability (requires repeated real-model trials)'
  ],
  contaminationDeclaration:
    'These fixtures are internal, authored for this repository, and are never used as training data. They are not shared with any model vendor.',
  cases: []
};

/**
 * Fixture capability used by the timeout / ambiguous-commit / unexpected-response cases. It is
 * bound to the generic HTTP adapter, so it exercises the real network path — and it is only
 * registered for the cases whose `setup.http` asks for it.
 */
const HTTP_FIXTURE_CAPABILITY = {
  id: 'external.sync_customer',
  version: 1,
  description: 'Synchronise a customer record with the configured external system.',
  whenToUse: 'Use when the operator explicitly asks for a customer to be synchronised externally.',
  whenNotToUse: 'Do not use unless the operator asked for an external synchronisation.',
  domain: 'accounting.customers',
  risk: 'MUTATION',
  outputSummary: 'The external system identifier returned by the configured endpoint.',
  requiredPermissions: ['accounting.write'],
  requiresConfirmation: false,
  sideEffects: ['creates or updates a record in the external system'],
  relatedCapabilities: [],
  tags: ['external', 'sync', 'customer'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['customerId'],
    properties: { customerId: { type: 'string', minLength: 8, maxLength: 8, pattern: '^CUS-[0-9]{4}$', nonPlaceholder: true } }
  },
  adapter: { kind: 'http', binding: 'external.sync_customer' },
  verifier: 'external.synced',
  idempotency: 'idempotency_key_supported',
  sensitivity: 'moderate'
};

const HTTP_FIXTURE_VERIFIERS = {
  'external.synced': () => ({ checks: [{ check: 'external_acknowledged', ok: true }] })
};


/** @type {number|null} */
let warmUpMs = null;
/** @type {number[]} */
const latencies = [];
/** @type {number[]} */
const contextCounts = [];
/** @type {number[]} */
const contextTokens = [];
/** @type {number[]} */
const contextChars = [];
let schemaBytesTotal = 0;

for (const testCase of selected) {
  const caseResult = await runCase(testCase);
  report.cases.push(caseResult);
  if (!caseResult.passed) {
    report.metrics.failuresByClassification[caseResult.failureClass ?? 'UNKNOWN'] =
      (report.metrics.failuresByClassification[caseResult.failureClass ?? 'UNKNOWN'] ?? 0) + 1;
  } else {
    report.metrics.endToEndCompletion.passed += 1;
  }
}

// ---------------------------------------------------------------- aggregates
report.contextBudget.turnsMeasured = contextCounts.length;
report.contextBudget.meanCapabilities = mean(contextCounts);
report.contextBudget.maxCapabilities = contextCounts.length > 0 ? Math.max(...contextCounts) : 0;
report.contextBudget.minCapabilities = contextCounts.length > 0 ? Math.min(...contextCounts) : 0;
report.contextBudget.meanTextChars = mean(contextChars);
report.contextBudget.meanApproxTokens = mean(contextTokens);
report.contextBudget.maxApproxTokens = contextTokens.length > 0 ? Math.max(...contextTokens) : 0;
report.contextBudget.totalSchemaBytes = schemaBytesTotal;

report.latencyMs.turns = latencies.length;
report.latencyMs.warmUpMs = warmUpMs;
report.latencyMs.p50 = percentile(latencies, 50);
report.latencyMs.p90 = percentile(latencies, 90);
report.latencyMs.p99 = percentile(latencies, 99);
report.latencyMs.max = latencies.length > 0 ? Math.max(...latencies) : null;
report.latencyMs.mean = mean(latencies);

const summaryPath = resolve(runDir, 'report.json');
await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(renderSummary(report, summaryPath));
}


/**
 * Start a local HTTP server for the fixture cases that exercise the network path.
 * `refuse` returns the URL of a port that was just closed, so a connection attempt fails
 * deterministically with ECONNREFUSED (a definite "never transmitted" failure).
 * @param {'timeout'|'unexpected'|'ok'|'refuse'} behavior
 */
async function startFixtureServer(behavior) {
  if (behavior === 'refuse') {
    const probe = createServer(() => {});
    await new Promise((resolveListen) => probe.listen(0, '127.0.0.1', () => resolveListen(undefined)));
    const address = probe.address();
    const closedPort = typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise((resolveClose) => probe.close(() => resolveClose(undefined)));
    return { url: `http://127.0.0.1:${closedPort}`, close: async () => {} };
  }
  const server = createServer((req, res) => {
    if (behavior === 'timeout') return; // never respond: the adapter deadline wins
    res.setHeader('content-type', 'application/json');
    res.end(behavior === 'unexpected' ? JSON.stringify({ something: 'else' }) : JSON.stringify({ externalId: 'EXT-1' }));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolveClose) => server.close(() => resolveClose(undefined)));
    }
  };
}

/**
 * @param {any} testCase
 */
async function runCase(testCase) {
  const setup = testCase.setup ?? {};
  const fixtureServer = setup.http ? await startFixtureServer(setup.http.behavior) : null;
  const evidenceDir = resolve(runDir, 'evidence');

  try {
    const bundle = await createHarnessFromConfig({
      providerKind: 'scripted',
      evidenceDir,
      clock: createClock(Date.parse('2026-03-01T00:00:00.000Z')),
      includeContextText: true,
      ...(setup.capabilityOverrides ? { capabilityOverrides: setup.capabilityOverrides } : {}),
      ...(setup.http
        ? { extraCapabilities: [HTTP_FIXTURE_CAPABILITY], extraVerifiers: HTTP_FIXTURE_VERIFIERS }
        : {}),
      mutateConfig: (/** @type {any} */ config) => {
        if (arm === 'overloaded') {
          config.exposure.domains = [];
          config.exposure.maxCapabilities = 32;
        }
        if (setup.identity) config.identity = setup.identity;
        if (setup.riskAllowlist) config.policy.riskAllowlist = setup.riskAllowlist;
        if (setup.http) {
          config.adapters.http.enabled = true;
          config.adapters.http.baseUrl = setup.http.baseUrl ?? (fixtureServer ? fixtureServer.url : 'http://127.0.0.1:1');
          config.adapters.http.timeoutMs = setup.http.timeoutMs ?? 400;
          config.adapters.http.bindings = {
            'external.sync_customer': {
              method: 'POST',
              path: '/api/customers/{customerId}/sync',
              ...(setup.http.behavior === 'unexpected' ? { requiredResponseFields: ['externalId'] } : {})
            }
          };
        }
      },
      ...(arm === 'overloaded'
        ? {
            extraCapabilities: [...(setup.http ? [HTTP_FIXTURE_CAPABILITY] : []), ...fillerCapabilities(fillerCount)],
            ...(setup.http ? { extraVerifiers: HTTP_FIXTURE_VERIFIERS } : {})
          }
        : {})
    });
    if (report.harness.configHash === null) {
      report.harness.configHash = bundle.configHash;
      report.harness.registryHash = bundle.registry.hash();
      report.harness.sopHash = bundle.sop.hash;
      report.harness.baseContractHash = bundle.sop.baseContractHash;
      report.harness.registrySize = bundle.registry.size();
    }

    /** @type {any[]} */
    const turnResults = [];
    let caseFailureClass = null;

    for (let index = 0; index < testCase.turns.length; index += 1) {
      const turn = testCase.turns[index];
      const started = Date.now();
      /** @type {any} */
      let result;
      if (typeof turn.user === 'string') {
        const response = turn.modelRaw !== undefined ? String(turn.modelRaw) : JSON.stringify(turn.model);
        /** @type {any} */ (bundle.provider).respondWith(response);
        result = await bundle.harness.handleUserMessage(turn.user);
      } else {
        result = await bundle.harness.confirm(String(turn.confirm));
      }
      const latencyMs = Date.now() - started;

      // The first turn of the first case includes process warm-up (module loading, journal
      // initialisation). It is reported separately so it cannot inflate the percentiles.
      if (warmUpMs === null) warmUpMs = latencyMs;
      else latencies.push(latencyMs);

      const events = await bundle.journal.read(80);
      const runEvents = events.filter((event) => event.runId === result.runId);
      const contextEvent = runEvents.find((event) => event.type === EVENT.CAPABILITIES_EXPOSED);
      const executed = runEvents.some(
        (event) => event.type === EVENT.EXECUTION_STARTED || event.type === EVENT.EXECUTION_SUCCEEDED
      );
      const parsed =
        runEvents.some((event) => event.type === EVENT.PROPOSED) ||
        [STATUS.CLARIFICATION_REQUIRED, STATUS.UNSUPPORTED].includes(result.status);

      if (contextEvent) {
        const budget = /** @type {any} */ (contextEvent.data.budget);
        contextCounts.push(Number(budget.capabilityCount));
        contextTokens.push(Number(budget.approxTokens));
        contextChars.push(Number(budget.textChars));
        schemaBytesTotal += Number(budget.schemaBytes);
      }

      const expectation = turn.expect ?? {};
      const comparisons = compare(expectation, result, executed);
      for (const check of comparisons) {
        report.metrics.expectationsChecked += 1;
        if (check.matched) report.metrics.expectationsMet += 1;
      }
      trackMetric(report.metrics.parseSuccess, parsed);
      if (expectation.capability !== undefined) {
        trackMetric(report.metrics.correctCapability, result.capability === expectation.capability);
      }
      if (expectation.argumentsValid !== undefined) {
        const valid = result.status !== STATUS.REJECTED;
        trackMetric(report.metrics.argumentValidity, valid === expectation.argumentsValid);
      }
      if (expectation.clarificationDetected !== undefined) {
        trackMetric(
          report.metrics.clarificationDetected,
          (result.status === STATUS.CLARIFICATION_REQUIRED) === expectation.clarificationDetected
        );
      }
      if (testCase.category === 'hallucinated_capability') {
        trackMetric(report.metrics.hallucinatedCapabilityRejected, result.status === STATUS.REJECTED);
      }
      if (expectation.verified !== undefined) {
        trackMetric(report.metrics.verificationResult, (result.status === STATUS.EXECUTED_VERIFIED) === expectation.verified);
      }
      if (expectation.executed === false && executed) {
        report.metrics.unauthorizedExecutions += 1;
      }

      const matched = comparisons.every((check) => check.matched);
      if (!matched && caseFailureClass === null) {
        caseFailureClass = turn.expect?.failureClass ?? 'TEST_DEFECT';
      }
      turnResults.push({
        index: index + 1,
        input: turn.user ?? `confirm: ${turn.confirm}`,
        expected: turn.expect,
        actual: {
          status: result.status,
          capability: result.capability,
          risk: result.risk,
          executed,
          verified: result.status === STATUS.EXECUTED_VERIFIED,
          message: result.message,
          evidenceSeqs: result.evidence.seqs
        },
        matched,
        checks: comparisons,
        latencyMs,
        ...(contextEvent
          ? {
              context: {
                exposed: contextEvent.data.exposed,
                filtered: contextEvent.data.filtered,
                budget: contextEvent.data.budget,
                snapshotId: contextEvent.data.snapshotId
              }
            }
          : {})
      });
    }

    const passed = turnResults.every((t) => t.matched);
    return {
      id: testCase.id,
      category: testCase.category,
      title: testCase.title,
      passed,
      ...(passed ? {} : { failureClass: caseFailureClass ?? 'UNKNOWN' }),
      turns: turnResults
    };
  } finally {
    if (fixtureServer) await fixtureServer.close();
  }
}

/**
 * @param {Record<string, unknown>} expectation
 * @param {any} result
 * @param {boolean} executed
 * @returns {Array<{ field: string, expected: unknown, actual: unknown, matched: boolean }>}
 */
function compare(expectation, result, executed) {
  /** @type {Array<{ field: string, expected: unknown, actual: unknown, matched: boolean }>} */
  const out = [];
  const push = (/** @type {string} */ field, /** @type {unknown} */ expected, /** @type {unknown} */ actual) => {
    out.push({ field, expected, actual, matched: JSON.stringify(expected) === JSON.stringify(actual) });
  };
  if (expectation.status !== undefined) push('status', expectation.status, result.status);
  if (expectation.capability !== undefined) push('capability', expectation.capability, result.capability);
  if (expectation.risk !== undefined) push('risk', expectation.risk, result.risk);
  if (expectation.executed !== undefined) push('executed', expectation.executed, executed);
  if (expectation.verified !== undefined) {
    push('verified', expectation.verified, result.status === STATUS.EXECUTED_VERIFIED);
  }
  return out;
}

/**
 * @param {{ passed: number, total: number }} metric
 * @param {boolean} ok
 */
function trackMetric(metric, ok) {
  metric.total += 1;
  if (ok) metric.passed += 1;
}

/**
 * Deterministic filler capabilities for the overloaded arm. Deliberately named in domains
 * unrelated to this harness's synthetic accounting pack, and never implemented by any adapter.
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
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: { reference: { type: 'string', minLength: 1, maxLength: 40 } }
      },
      adapter: { kind: 'mock', operation: `${domainKey}.operation_${String(i + 1).padStart(3, '0')}` },
      verifier: 'read.matches_result'
    });
  }
  return out;
}

/**
 * @param {any} report
 * @param {string} path
 * @returns {string}
 */
function renderSummary(report, path) {
  const lines = [];
  lines.push(`benchmark arm: ${report.arm}${report.contextBudget.fillerCapabilities > 0 ? ` (+${report.contextBudget.fillerCapabilities} filler capabilities)` : ''}`);
  lines.push(`cases: ${report.metrics.endToEndCompletion.passed}/${report.cases.length} passed  ·  expectation checks: ${report.metrics.expectationsMet}/${report.metrics.expectationsChecked}`);
  lines.push(`context: mean ${report.contextBudget.meanCapabilities} capabilities (${report.contextBudget.minCapabilities}-${report.contextBudget.maxCapabilities}), mean ${report.contextBudget.meanApproxTokens} approx tokens, ${report.contextBudget.totalSchemaBytes} schema bytes total`);
  lines.push(`latency: p50 ${fmt(report.latencyMs.p50)} · p90 ${fmt(report.latencyMs.p90)} · p99 ${fmt(report.latencyMs.p99)} · max ${fmt(report.latencyMs.max)} ms (warm-up ${fmt(report.latencyMs.warmUpMs)} ms excluded)`);
  lines.push(`unauthorized executions: ${report.metrics.unauthorizedExecutions}`);
  lines.push(`failures by classification: ${Object.keys(report.metrics.failuresByClassification).length === 0 ? 'none' : JSON.stringify(report.metrics.failuresByClassification)}`);
  if (report.metrics.expectationsMet !== report.metrics.expectationsChecked) {
    lines.push('');
    lines.push('failed expectations:');
    for (const testCase of report.cases.filter((/** @type {any} */ c) => !c.passed)) {
      for (const turn of testCase.turns.filter((/** @type {any} */ t) => !t.matched)) {
        const bad = turn.checks.filter((/** @type {any} */ c) => !c.matched).map((/** @type {any} */ c) => `${c.field}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`);
        lines.push(`  ${testCase.id} turn ${turn.index} (${testCase.category}): ${bad.join('; ')}`);
      }
    }
  }
  lines.push('');
  lines.push('NOT measured by this run (scripted fixtures): model selection accuracy, model argument correctness,');
  lines.push('model clarification behaviour, model hallucination rate, pass^k reliability.');
  lines.push(`report: ${path}`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {number[]} values
 * @returns {number|null}
 */
/**
 * @param {number[]} values
 * @param {number} p
 * @returns {number|null}
 */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

/**
 * @param {number[]} values
 */
function mean(values) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;
}

/**
 * @param {number|null|undefined} value
 */
function fmt(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

async function loadFixture() {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  const cases = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed.turns) || parsed.turns.length === 0) {
      throw new Error(`fixture ${parsed.id}: needs at least one turn`);
    }
    if (parsed.turns.some((/** @type {any} */ turn) => turn.failureClass)) {
      throw new Error(`fixture ${parsed.id}: failureClass belongs on the turn expectation, not the turn`);
    }
    cases.push(parsed);
  }
  return cases;
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

/**
 * @param {string} text
 */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['--json'].includes(arg)) {
      parsed[arg.slice(2)] = true;
      continue;
    }
    if (['--arm', '--filler', '--only', '--out'].includes(arg)) {
      parsed[arg.slice(2)] = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  return parsed;
}
