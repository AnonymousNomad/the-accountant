#!/usr/bin/env node
/**
 * Scale-simulation runner — four tool surfaces, one model, one task corpus.
 *
 *   raw         394 synthetic routes, minimal descriptions
 *   documented  394 routes with real descriptions/schemas/when-to-use
 *   semantic    the ~56-capability semantic registry, no task filtering
 *   bounded     semantic registry filtered to the task-relevant domains + full SOP/context
 *
 * All four arms keep the identical harness safety boundary (policy, permits, adapters,
 * verification, evidence). Only the tool surface and the guidance differ, which is what makes the
 * A→B (documentation), B→C (abstraction) and C→D (bounded context) deltas attributable
 * (directive §13). Nothing here is a model-quality claim about the collaborator's application:
 * the workload is SCALE-FAITHFUL / BEHAVIOR-SYNTHETIC / NOT A REPLICA (docs/SCALE_SIMULATION.md).
 *
 * Usage:
 *   node benchmarks/run-scale-simulation.mjs --surface bounded --tasks 20 --reps 1 --threads 6
 *   node benchmarks/run-scale-simulation.mjs --measure            # context size only, no inference
 *
 * @module benchmarks/run-scale-simulation
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createHarnessFromConfig } from '../src/bootstrap.mjs';
import { createLlamaServerProvider } from '../src/models/llama-server-provider.mjs';
import { STATUS } from '../src/harness.mjs';
import { buildCapabilityContext } from '../src/registry/context.mjs';
import { defineCapability } from '../src/registry/capability.mjs';

const argv = process.argv.slice(2);
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : String(argv[index + 1] ?? fallback);
};
const SURFACE = arg('--surface', 'bounded');
const TASK_LIMIT = Number.parseInt(arg('--tasks', '20'), 10);
const REPS = Number.parseInt(arg('--reps', '1'), 10);
const PORT = Number.parseInt(arg('--port', '8098'), 10);
const THREADS = Number.parseInt(arg('--threads', '6'), 10);
const MAX_TOKENS = Number.parseInt(arg('--max-tokens', '512'), 10);
const CTX = Number.parseInt(arg('--ctx', '4096'), 10);
const MEASURE_ONLY = argv.includes('--measure');
const LIVE_CONFIG = JSON.parse(readFileSync(resolve(process.cwd(), 'config/harness.live-230m.json'), 'utf8'));

const routes = readJson('simulation/generated-routes.json').routes;
const semantic = readJson('simulation/semantic-capabilities.json').capabilities.map(stripProvenance);
const screens = readJson('simulation/generated-screens.json').screens;
const jurisdictions = readJson('simulation/jurisdiction-config.json').jurisdictions;
const tasks = readJsonl('simulation/task-corpus.jsonl');
const routeById = new Map(routes.map((/** @type {any} */ route) => [route.id, route]));

if (!['raw', 'documented', 'semantic', 'bounded'].includes(SURFACE)) {
  process.stderr.write(`unknown surface ${SURFACE}; expected raw|documented|semantic|bounded\n`);
  process.exit(3);
}

/** Deterministic tool-surface measurements (directive §10) — computed without any inference. */
if (MEASURE_ONLY) {
  const measurements = measureSurfaces();
  mkdirSync(resolve('benchmarks', 'results', 'scale'), { recursive: true });
  const out = resolve('benchmarks', 'results', 'scale', 'surface-measurements.json');
  writeFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), scale: { routes: routes.length, semanticCapabilities: semantic.length }, surfaces: measurements }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
  process.stdout.write(`\nmeasurements: ${out}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------- live run

const engine = createLlamaServerProvider({
  executable: String(LIVE_CONFIG.provider.executable),
  modelPath: String(LIVE_CONFIG.provider.modelPath),
  manageServer: true,
  port: PORT,
  ctxSize: CTX,
  threads: THREADS,
  startupTimeoutMs: 120000,
  inferenceTimeoutMs: 240000,
  temperature: Number(LIVE_CONFIG.provider.temperature ?? 0.1),
  topK: Number(LIVE_CONFIG.provider.topK ?? 50),
  repeatPenalty: Number(LIVE_CONFIG.provider.repeatPenalty ?? 1.05),
  maxTokens: MAX_TOKENS,
  structuredMode: String(LIVE_CONFIG.provider.structuredMode ?? 'json_schema')
});
/** @type {any[]} */
const calls = [];
const wrapped = {
  kind: engine.kind,
  model: engine.model,
  async complete(/** @type {any} */ request) {
    const started = Date.now();
    const result = await engine.complete(request);
    calls.push({ wallMs: Date.now() - started, ...result.meta });
    return result;
  },
  stop: () => /** @type {any} */ (engine).stop()
};

const report = /** @type {any} */ ({
  benchmark: 'scale-simulation',
  surface: SURFACE,
  at: new Date().toISOString(),
  scale: { routes: routes.length, entities: readJson('simulation/generated-entities.json').entities.length, screens: screens.length, jurisdictions: jurisdictions.map((/** @type {any} */ j) => j.code), semanticCapabilities: semantic.length },
  surfaces: measureSurfaces(),
  tasks: { requested: TASK_LIMIT, repetitions: REPS },
  sampling: { temperature: 0.1, topK: 50, repeatPenalty: 1.05, maxTokens: MAX_TOKENS, threads: THREADS, ctxSize: CTX },
  metrics: {},
  harnessMetrics: { unauthorizedExecutions: 0, falseVerified: 0, executionsOutsideSnapshot: 0 },
  cases: []
});

try {
  await engine.ensureStarted();
  const selected = tasks.slice(0, TASK_LIMIT);
  for (let rep = 1; rep <= REPS; rep += 1) {
    for (const task of selected) {
      report.cases.push(await runTask(task, rep));
    }
    process.stdout.write(`surface ${SURFACE}: repetition ${rep}/${REPS} complete (${report.cases.length} task-runs)\n`);
  }
} finally {
  await /** @type {any} */ (engine).stop();
}

aggregate();
mkdirSync(resolve('benchmarks', 'results', 'scale'), { recursive: true });
const out = resolve('benchmarks', 'results', 'scale', `${SURFACE}-${report.at.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(renderSummary(report));
process.stdout.write(`\nreport: ${out}\n`);

/**
 * @param {any} task
 * @param {number} rep
 */
async function runTask(task, rep) {
  const extraCapabilities = surfaceCapabilities();
  const relevantDomains = domainsForTask(task);
  const bundle = await createHarnessFromConfig({
    configPath: resolve('config/harness.live-230m.json'),
    provider: /** @type {any} */ (wrapped),
    includeContextText: true,
    includeDefaultPack: false,
    mockAdapter: {
      kind: 'mock',
      enabled: true,
      has: () => true,
      execute: (/** @type {any} */ input) => ({ ok: true, data: { simulated: true, operation: input.operation, capability: input.capability.id } })
    },
    extraVerifiers: { 'sim.ack': () => ({ checks: [{ check: 'simulated_ack', ok: true }] }) },
    extraCapabilities,
    ...(SURFACE === 'bounded'
      ? {
          mutateConfig: (/** @type {any} */ config) => {
            config.exposure.domains = relevantDomains;
            config.exposure.maxCapabilities = 12;
          }
        }
      : {
          mutateConfig: (/** @type {any} */ config) => {
            config.exposure.domains = [];
            config.exposure.maxCapabilities = 400;
          }
        })
  });

  const userMessage = task.text;
  const started = Date.now();
  const result = await bundle.harness.handleUserMessage(userMessage);
  const events = await bundle.journal.read(200);
  const runEvents = events.filter((/** @type {any} */ event) => event.runId === result.runId);
  const proposed = runEvents.find((/** @type {any} */ event) => event.type === 'PROPOSED');
  const rejected = runEvents.find((/** @type {any} */ event) => event.type === 'PROPOSAL_REJECTED');
  const contextEvent = runEvents.find((/** @type {any} */ event) => event.type === 'CAPABILITIES_EXPOSED');
  const executed = runEvents.some((/** @type {any} */ event) => event.type === 'EXECUTION_STARTED' || event.type === 'EXECUTION_SUCCEEDED');
  const authorized = runEvents.some((/** @type {any} */ event) => event.type === 'AUTHORIZED');
  const exposed = Array.isArray(contextEvent?.data?.exposed) ? contextEvent.data.exposed : [];

  const expectedKind = task.expected?.kind ?? 'proposal';
  const kindOk =
    expectedKind === 'proposal'
      ? /** @type {string[]} */ ([STATUS.CONFIRMATION_REQUIRED, STATUS.EXECUTED_VERIFIED, STATUS.DENIED, STATUS.COMMIT_UNKNOWN]).includes(result.status)
      : expectedKind === 'clarification'
        ? result.status === STATUS.CLARIFICATION_REQUIRED
        : result.status === STATUS.UNSUPPORTED;
  const capabilityOk = expectedKind !== 'proposal' || result.capability === task.expected?.capability;

  return {
    taskId: task.id,
    category: task.category,
    repetition: rep,
    text: task.text.slice(0, 120),
    jurisdiction: task.jurisdiction,
    screen: task.screen,
    expected: task.expected ?? null,
    actual: { status: result.status, capability: result.capability, executed, message: String(result.message).slice(0, 200) },
    kindOk,
    capabilityOk,
    passed: kindOk && capabilityOk,
    signals: {
      proposalPresent: Boolean(proposed),
      rejectionCode: rejected?.data?.code ?? null,
      argumentKeys: proposed ? Object.keys(/** @type {any} */ (result.proposal?.arguments ?? {})) : [],
      referenceArgumentKeys: task.expected?.arguments ? Object.keys(task.expected.arguments) : [],
      clarification: result.status === STATUS.CLARIFICATION_REQUIRED,
      unsupported: result.status === STATUS.UNSUPPORTED,
      authorization: !executed ? 'NOT_EXECUTED' : authorized && exposed.includes(String(result.capability)) ? 'AUTHORIZED_IN_SNAPSHOT' : authorized ? 'AUTHORIZED' : 'MISSING_BUT_EXECUTED'
    },
    wallMs: Date.now() - started,
    toolSurface: contextEvent?.data?.budget ?? null
  };
}

function aggregate() {
  const cases = report.cases;
  const metric = (/** @type {(c: any) => boolean} */ predicate) => cases.filter(predicate).length;
  report.metrics = {
    taskRuns: cases.length,
    passed: metric((/** @type {any} */ c) => c.passed),
    passRate: cases.length === 0 ? null : round(metric((/** @type {any} */ c) => c.passed) / cases.length),
    kindCorrect: metric((/** @type {any} */ c) => c.kindOk),
    capabilityCorrect: metric((/** @type {any} */ c) => c.capabilityOk),
    proposalsPresent: metric((/** @type {any} */ c) => c.signals.proposalPresent),
    clarifications: metric((/** @type {any} */ c) => c.signals.clarification),
    unsupportedDeclared: metric((/** @type {any} */ c) => c.signals.unsupported),
    rejected: metric((/** @type {any} */ c) => c.actual.status === STATUS.REJECTED),
    hallucinatedCapability: cases.filter((/** @type {any} */ c) => c.signals.rejectionCode === 'UNKNOWN_CAPABILITY').length,
    byCategory: groupBy(cases, 'category')
  };
  report.harnessMetrics.unauthorizedExecutions = cases.filter((/** @type {any} */ c) => c.signals.authorization === 'MISSING_BUT_EXECUTED').length;
  report.harnessMetrics.executionsOutsideSnapshot = cases.filter((/** @type {any} */ c) => c.signals.authorization === 'AUTHORIZED' && c.actual.capability === null).length;
  report.harnessMetrics.falseVerified = cases.filter((/** @type {any} */ c) => c.passed === false && c.actual.status === STATUS.EXECUTED_VERIFIED && c.expected?.kind !== 'proposal').length;
  const latencies = calls.map((/** @type {any} */ call) => Number(call.wallMs));
  const budgets = cases.map((/** @type {any} */ c) => c.toolSurface).filter(Boolean);
  report.distribution = {
    calls: calls.length,
    latencyMs: { p50: percentile(latencies, 50), p90: percentile(latencies, 90), max: latencies.length > 0 ? Math.max(...latencies) : null },
    promptTokensMean: mean(calls, 'promptTokens'),
    completionTokensMean: mean(calls, 'completionTokens'),
    promptEvalMsMean: mean(calls, 'promptEvalMs'),
    emptyResponses: calls.filter((/** @type {any} */ call) => call.contentChars === 0).length,
    toolContext: {
      meanCapabilities: mean(budgets.map((/** @type {any} */ b) => Number(b.capabilityCount))),
      meanApproxTokens: mean(budgets.map((/** @type {any} */ b) => Number(b.approxTokens))),
      maxApproxTokens: budgets.length > 0 ? Math.max(...budgets.map((/** @type {any} */ b) => Number(b.approxTokens))) : null
    }
  };
}

// ---------------------------------------------------------------------------- surfaces

function surfaceCapabilities() {
  if (SURFACE === 'raw') return routes.map((/** @type {any} */ route) => routeCapability(route, 'minimal'));
  if (SURFACE === 'documented') return routes.map((/** @type {any} */ route) => routeCapability(route, 'documented'));
  return semantic;
}

/**
 * @param {Record<string, unknown>} route
 * @param {'minimal'|'documented'} style
 */
function routeCapability(route, style) {
  const id = String(route.id);
  const domain = `sim.${String(route.domain)}`;
  const risk = String(route.risk);
  const description =
    style === 'minimal'
      ? `${String(route.minimalDescription).replace(/\.$/, '')} (internal route ${String(route.path)}).`
      : `${String(route.documentedDescription)} Route: ${String(route.method)} ${String(route.path)}.`;
  return defineCapability({
    id: id.length >= 3 ? id : `route.${id}`,
    version: 1,
    description: description.length >= 20 ? description : `${description} (synthetic internal route)`,
    whenToUse:
      style === 'minimal'
        ? `Use when the request maps directly to ${String(route.path)}.`
        : String(route.whenToUse ?? `Use when the operator asks for ${String(route.path)}.`),
    whenNotToUse:
      style === 'minimal'
        ? 'Do not use for any other operation.'
        : String(route.whenNotToUse ?? 'Do not use when the request belongs to a different operation.'),
    domain,
    risk,
    outputSummary: String(route.outputSummary ?? 'Synthetic route acknowledgement.'),
    requiredPermissions: ['accounting.read'],
    requiresConfirmation: risk === 'FINANCIAL',
    sideEffects: Array.isArray(route.sideEffects) && route.sideEffects.length > 0 ? route.sideEffects : ['synthetic state change'],
    relatedCapabilities: [],
    tags: [...new Set([String(route.domain), ...String(route.path).split(/[^a-z0-9]+/i).filter((/** @type {string} */ part) => part.length > 2).slice(0, 6)])],
    inputSchema: route.inputSchema,
    adapter: { kind: 'mock', operation: String(route.id) },
    verifier: 'sim.ack',
    idempotency: risk === 'READ' ? 'naturally_idempotent' : 'idempotency_key_supported',
    sensitivity: risk === 'READ' ? 'low' : 'moderate'
  });
}

/**
 * Deterministic relevance for the bounded arm: the task's expected capability domain, or — for
 * clarification/unsupported tasks — the screen's declared domains. No model involvement.
 * @param {any} task
 * @returns {string[]}
 */
function domainsForTask(task) {
  const expectedId = task.expected?.capability;
  if (expectedId) {
    const capability = semantic.find((/** @type {any} */ entry) => entry.id === expectedId);
    if (capability) return [String(capability.domain)];
  }
  const screen = screens.find((/** @type {any} */ entry) => entry.id === task.screen);
  if (screen && Array.isArray(screen.relevantCapabilityDomains) && screen.relevantCapabilityDomains.length > 0) {
    return screen.relevantCapabilityDomains.slice(0, 3);
  }
  return ['accounting.invoices', 'accounting.customers', 'accounting.ledger'];
}

/**
 * Tool-surface measurements for every arm, computed from the real renderer — no inference needed.
 */
function measureSurfaces() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const surface of ['raw', 'documented', 'semantic', 'bounded']) {
    const previous = SURFACE;
    // buildCapabilityContext is the same renderer the harness uses, so these are real numbers
    const registryLike = {
      list: () => {
        if (surface === 'raw') return routes.map((/** @type {any} */ r) => routeCapability(r, 'minimal'));
        if (surface === 'documented') return routes.map((/** @type {any} */ r) => routeCapability(r, 'documented'));
        return semantic.map((/** @type {any} */ entry) => defineCapability(entry));
      },
      hash: () => 'measure',
      listEnabled() {
        return this.list();
      }
    };
    const config = {
      exposure: { maxCapabilities: surface === 'bounded' ? 12 : 400, domains: surface === 'bounded' ? ['accounting.invoices'] : [] },
      policy: { grantedPermissions: ['accounting.read', 'accounting.write', 'accounting.financial', 'payroll.read', 'payroll.write', 'inventory.read', 'inventory.write', 'admin.read'] }
    };
    const context = buildCapabilityContext({ registry: /** @type {any} */ (registryLike), config, taskText: '', prerequisite: () => ({ available: true }) });
    out[surface] = {
      capabilitiesExposed: context.budget.capabilityCount,
      contextChars: context.budget.textChars,
      approxTokens: context.budget.approxTokens,
      schemaBytes: context.budget.schemaBytes,
      fitsContext4096: context.budget.approxTokens < 3800,
      note: surface === 'bounded' ? 'measured with a single-domain filter and a 12-capability cap' : 'unfiltered surface'
    };
    void previous;
  }
  return out;
}

// ---------------------------------------------------------------------------- helpers

function readJson(/** @type {string} */ path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function readJsonl(/** @type {string} */ path) {
  return readFileSync(resolve(path), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'))
    .map((line) => JSON.parse(line));
}

/** Registry validation rejects unknown keys; provenance keys are simulation-only. */
function stripProvenance(/** @type {Record<string, unknown>} */ capability) {
  const { mapsToRoutes, ...rest } = capability;
  void mapsToRoutes;
  return rest;
}

function groupBy(/** @type {any[]} */ values, /** @type {string} */ key) {
  /** @type {Record<string, { total: number, passed: number }>} */
  /** @type {Record<string, any>} */
  const out = {};
  for (const value of values) {
    const bucket = out[value[key]] ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (value.passed) bucket.passed += 1;
    out[value[key]] = bucket;
  }
  return out;
}

function mean(/** @type {any[]} */ values, /** @type {string|null} */ key = null) {
  const numbers = values.map((value) => Number(value[key])).filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function percentile(/** @type {number[]} */ values, /** @type {number} */ p) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function round(/** @type {number} */ value) {
  return Math.round(value * 1000) / 1000;
}

function renderSummary(/** @type {any} */ report) {
  const surfaces = Object.entries(report.surfaces)
    .map(([name, value]) => `${name}: ${/** @type {any} */ (value).capabilitiesExposed} tools / ~${/** @type {any} */ (value).approxTokens} tokens`)
    .join('  ·  ');
  return [
    `scale simulation — surface ${report.surface}`,
    `tasks: ${report.metrics.taskRuns} runs · pass ${report.metrics.passed} (${report.metrics.passRate}) · kind ok ${report.metrics.kindCorrect} · capability ok ${report.metrics.capabilityCorrect}`,
    `model: proposals ${report.metrics.proposalsPresent} · clarifications ${report.metrics.clarifications} · unsupported ${report.metrics.unsupportedDeclared} · rejected ${report.metrics.rejected} · hallucinated capability ${report.metrics.hallucinatedCapability}`,
    `harness: unauthorized ${report.harnessMetrics.unauthorizedExecutions} · false verified ${report.harnessMetrics.falseVerified}`,
    `distribution: p50 ${report.distribution.latencyMs.p50} ms · p90 ${report.distribution.latencyMs.p90} ms · prompt tokens mean ${report.distribution.promptTokensMean} · empty responses ${report.distribution.emptyResponses}`,
    `tool surface sizes: ${surfaces}`
  ].join('\n');
}
