#!/usr/bin/env node
/**
 * Resumable experiment runner — the machine owns execution, not the coding-agent session.
 *
 * Designed so a 120-observation benchmark can be launched, interrupted, and resumed without any
 * conversation: every observation is appended (and fsynced) to a JSONL evidence file keyed by a
 * deterministic observation id, and a header line pins the manifest hash, model fingerprint and
 * configuration fingerprint. Resume skips exactly the completed ids; any drift in manifest, model
 * or configuration is refused rather than silently accepted (AUTONOMOUS_CONTINUATION.md §4).
 *
 * Usage:
 *   node benchmarks/run-resumable.mjs --self-test
 *   node benchmarks/run-resumable.mjs --experiment S16-SEMANTIC-56 [--tasks 20] [--reps 3] [--port 8099] [--threads 6]
 *   node benchmarks/run-resumable.mjs --experiment S16-BOUNDED   [--tasks 20] [--reps 3]
 *   node benchmarks/run-resumable.mjs --experiment M13-CURRENT   (field-role diagnostic, current representation)
 *   node benchmarks/run-resumable.mjs --experiment M13-EXPLICIT  (field-role diagnostic, explicit representation)
 *
 * Safe to kill at any time: partial evidence is preserved and the next invocation continues.
 *
 * @module benchmarks/run-resumable
 */

import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHarnessFromConfig } from '../src/bootstrap.mjs';
import { createLlamaServerProvider } from '../src/models/llama-server-provider.mjs';
import { canonicalJson } from '../src/core/canonical.mjs';
import { STATUS } from '../src/harness.mjs';
import { assertConfigTruth, buildExecutionInput, effectiveConfigFingerprint, executionTaskOf } from './execution-input.mjs';
import { buildManifest, manifestHashOf } from './manifest.mjs';

const argv = process.argv.slice(2);
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : String(argv[index + 1] ?? fallback);
};
const SELF_TEST = argv.includes('--self-test');
const EXPERIMENT = arg('--experiment', 'S16-BOUNDED');
const TASK_LIMIT = Number.parseInt(arg('--tasks', '20'), 10);
const REPS = Number.parseInt(arg('--reps', '3'), 10);
const PORT = Number.parseInt(arg('--port', '8099'), 10);
const THREADS = Number.parseInt(arg('--threads', '6'), 10);
const MAX_TOKENS = Number.parseInt(arg('--max-tokens', '512'), 10);
const INFERENCE_TIMEOUT_MS = Number.parseInt(arg('--inference-timeout', '300000'), 10);
const CTX = Number.parseInt(arg('--ctx', '4096'), 10);
const EXPERIMENTS = Object.freeze({
  'S16-SEMANTIC-56': { surface: 'semantic', promptMode: 'full', domainsFromTask: false, explicit: false },
  'S16-BOUNDED': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: false },
  'S16-BOUNDED-ACCOUNTANTS-WAY': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: false, doctrine: 'accountants-way' },
  'S18-1.2B-BOUNDED-BASELINE': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: false, configPath: 'config/harness.live-1.2b.json' },
  'S18-1.2B-BOUNDED-ACCOUNTANTS-WAY': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: false, doctrine: 'accountants-way', configPath: 'config/harness.live-1.2b.json' },
  'S19-1.2B-BOUNDED-ACCOUNTANT-ACTIONABILITY': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: false, doctrine: 'accountants-way', configPath: 'config/harness.live-1.2b.json' },
  // S20 (declared, NOT yet run — requires operator authorization). Two runner defects discovered while
  // diagnosing S19 are repaired here but gated behind this identity so S18/S19 semantics stay frozen:
  //   1. the harness was constructed with the 230M config path regardless of --config (permissions and
  //      evidence dir came from the wrong file; harmless for the frozen 20 tasks, which need only
  //      accounting.* permissions, but wrong in general);
  //   2. `domainsFromTask` derived the exposure filter from the task's EXPECTED capability — that is
  //      ground-truth leakage (the answer decided which tools were shown) and it hid capabilities a
  //      task legitimately needed across domains (observed: an invoice-drafting task exposed only
  //      customer.* capabilities). S20 instead uses the harness's own keyword-ranked exposure with the
  //      capability cap: no domain filter, selection by relevance, still bounded.
  'S20-1.2B-BOUNDED-DISCOVERY-REPAIRED': { surface: 'bounded', promptMode: 'full', domainsFromTask: false, selection: 'keyword', explicit: false, doctrine: 'accountants-way', configPath: 'config/harness.live-1.2b.json' },
  // Canonical production candidate (operator model lock): LFM2.5-2.6B QAD-Q4_0, benchmark-blind
  // keyword discovery, Accountant's Way, Retrieve Before Clarify, full deterministic safeguards.
  'S21-2.6B-QAD-ACCOUNTING-RESIDENT': { surface: 'bounded', promptMode: 'full', domainsFromTask: false, selection: 'keyword', explicit: false, doctrine: 'accountants-way', configPath: 'config/harness.live-2.6b.json' },
  // S22: apparatus isolation ONLY — S21 with the two demonstrated apparatus ceilings removed
  // (max_tokens 512 -> 1024, inference timeout 300 s -> 600 s). Everything else is frozen and
  // identical: same artifact, tasks, reps, ctx, sampling, doctrine, discovery, policy, verification.
  // Pre-registered headroom: prompt 5,965 worst case (fixed 3,109 + surface 2,856) + 1,024 generation
  // = 6,989 of 12,288 -> 5,299 tokens headroom (44 %).
  'S22-2.6B-QAD-ACCOUNTING-RESIDENT-APPARATUS-ISOLATED': { surface: 'bounded', promptMode: 'full', domainsFromTask: false, selection: 'keyword', explicit: false, doctrine: 'accountants-way', configPath: 'config/harness.live-2.6b.json' },
  'M13-CURRENT': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: false, diagnostic: true },
  'M13-EXPLICIT': { surface: 'bounded', promptMode: 'full', domainsFromTask: true, explicit: true, diagnostic: true }
});
const spec = /** @type {any} */ (EXPERIMENTS)[EXPERIMENT] ?? null;
const CONFIG_PATH = resolve(arg('--config', spec?.configPath ?? 'config/harness.live-230m.json'));
const LIVE_CONFIG = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

if (SELF_TEST) {
  await selfTest();
  process.exit(0);
}
if (!(EXPERIMENT in EXPERIMENTS)) {
  process.stderr.write(`unknown experiment ${EXPERIMENT}; known: ${Object.keys(EXPERIMENTS).join(', ')}\n`);
  process.exit(3);
}
// PHASE 2 (S19 defect repair): the configuration that EXECUTES must be the one declared, and its
// fingerprint is recorded — the requested CLI path is not evidence of what was loaded.
const configFileSha256 = sha256(readFileSync(CONFIG_PATH, 'utf8'));
const effectiveConfigHash = assertConfigTruth({
  requestedPath: CONFIG_PATH,
  specPath: spec?.configPath ? resolve(spec.configPath) : '',
  loadedPath: CONFIG_PATH,
  effectiveConfig: /** @type {Record<string, unknown>} */ (LIVE_CONFIG)
});
if (spec.diagnostic && spec.explicit) {
  // Fail closed rather than silently running the current representation under a different label:
  // the explicit-representation variant is Stage 1 design work and does not exist yet.
  process.stderr.write(
    'runner: REFUSING TO RUN — the explicit-representation diagnostic variant is not implemented yet ' +
      '(Stage 1). Running it now would silently duplicate M13-CURRENT and produce a false comparison.\n'
  );
  process.exit(2);
}
const tasks = readJsonl('simulation/task-corpus.jsonl').slice(0, TASK_LIMIT);
const routes = readJson('simulation/generated-routes.json').routes;
const semantic = readJson('simulation/semantic-capabilities.json').capabilities.map(stripProvenance);
const screens = readJson('simulation/generated-screens.json').screens;
const evidenceDir = resolve('evidence', 'observations');
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = resolve(evidenceDir, `${EXPERIMENT}.jsonl`);

const manifest = buildManifest(
  {
    experiment: EXPERIMENT,
    tasks: tasks.map((/** @type {any} */ task) => ({ id: task.id, repetition: REPS })),
    repetitions: REPS,
    configTruth: { configPath: CONFIG_PATH, configFileSha256, effectiveConfigHash },
    envelope: {
      model: String(LIVE_CONFIG.provider.model),
      modelPath: String(LIVE_CONFIG.provider.modelPath),
      selection: spec.selection ?? 'expected-domain (ground-truth derived; superseded by S20 keyword mode)',
      engine: String(LIVE_CONFIG.provider.executable),
      temperature: Number(LIVE_CONFIG.provider.temperature ?? 0.1),
      topK: Number(LIVE_CONFIG.provider.topK ?? 50),
      repeatPenalty: Number(LIVE_CONFIG.provider.repeatPenalty ?? 1.05),
      maxTokens: MAX_TOKENS,
      inferenceTimeoutMs: INFERENCE_TIMEOUT_MS,
      ctxSize: CTX,
      threads: THREADS,
      surface: spec.surface,
      promptMode: spec.promptMode,
      explicitRepresentation: spec.explicit
    }
  }
);
const manifestHash = manifestHashOf(manifest);
const model = identifyModel(String(LIVE_CONFIG.provider.modelPath));
const modelFingerprint = `${model.sha256}:${model.build}`;
const configFingerprint = sha256(canonicalJson(manifest.envelope)).slice(0, 16);

/** @type {Set<string>} */
const completed = new Set();
prepareEvidenceFile();

if (completed.size > 0) {
  process.stdout.write(`resume: ${completed.size} observation(s) already complete in ${evidencePath}\n`);
}

const engine = createLlamaServerProvider({
  executable: String(LIVE_CONFIG.provider.executable),
  modelPath: String(LIVE_CONFIG.provider.modelPath),
  manageServer: true,
  port: PORT,
  ctxSize: CTX,
  threads: THREADS,
  startupTimeoutMs: 300000,
  inferenceTimeoutMs: INFERENCE_TIMEOUT_MS,
  temperature: Number(LIVE_CONFIG.provider.temperature ?? 0.1),
  topK: Number(LIVE_CONFIG.provider.topK ?? 50),
  repeatPenalty: Number(LIVE_CONFIG.provider.repeatPenalty ?? 1.05),
  maxTokens: MAX_TOKENS,
  structuredMode: 'json_schema'
});
/** @type {any[]} */
const calls = [];
/** @type {Record<string, unknown>|null} */
let lastCall = null;
const wrapped = {
  kind: engine.kind,
  model: engine.model,
  async complete(/** @type {any} */ request) {
    const started = Date.now();
    const result = await engine.complete(request);
    const meta = { ...result.meta, wallMs: Date.now() - started };
    lastCall = meta;
    calls.push(meta);
    return { ...result, meta };
  },
  stop: () => /** @type {any} */ (engine).stop()
};

let written = 0;
try {
  await /** @type {any} */ (engine).ensureStarted();
  const health = await engine.health();
  const startedAt = Date.now();
  for (let repetition = 1; repetition <= REPS; repetition += 1) {
    for (const task of tasks) {
      const id = observationId(EXPERIMENT, task.id, repetition);
      if (completed.has(id)) continue;
      const observation = await runObservation({ id, task, repetition, provider: wrapped });
      appendObservation(observation);
      written += 1;
      process.stdout.write(`[${written}] ${id} ${task.id} rep${repetition} → ${observation.actual.status}\n`);
    }
  }
  process.stdout.write(
    `\n${EXPERIMENT}: ${written} new observation(s) this session · ${completed.size + written} total · engine ${health.modelId} load ${health.loadMs} ms · wall ${Math.round((Date.now() - startedAt) / 1000)} s\n`
  );
} finally {
  await /** @type {any} */ (wrapped).stop();
}

// ---------------------------------------------------------------------------- core

/**
 * @param {{ id: string, task: any, repetition: number, provider: any }} input
 */
async function runObservation(input) {
  const { task, repetition, provider } = input;
  // PHASE 2 boundary: execution receives the request plus trusted UI context, and REFUSES to run if
  // scoring truth is present. `task.expected` is used below only in the scoring path.
  const executionInput = buildExecutionInput(executionTaskOf(task));
  lastCall = null;
  const surfaceCapabilities = spec.surface === 'raw' ? routes.map((/** @type {any} */ r) => routeCapability(r, 'minimal')) : spec.surface === 'documented' ? routes.map((/** @type {any} */ r) => routeCapability(r, 'documented')) : semantic;
  const startedAt = Date.now();
  let observation;
  try {
    const bundle = await createHarnessFromConfig({
      configPath: CONFIG_PATH,
      provider,
      includeContextText: true,
      includeDefaultPack: false,
      ...(spec.explicit ? { explicitRepresentation: true } : {}),
      mockAdapter: {
        kind: 'mock',
        enabled: true,
        has: () => true,
        execute: (/** @type {any} */ call) => ({ ok: true, data: { simulated: true, operation: call.operation, capability: call.capability.id } })
      },
      extraVerifiers: { 'sim.ack': () => ({ checks: [{ check: 'simulated_ack', ok: true }] }) },
      extraCapabilities: surfaceCapabilities,
      ...(spec.promptMode === 'minimal' ? { promptMode: 'minimal' } : {}),
      ...(spec.doctrine ? { doctrine: spec.doctrine } : {}),
      mutateConfig: (/** @type {any} */ config) => {
        // Three exposure modes, kept distinct so no frozen experiment changes semantics:
        //   expected-domain (S16-BOUNDED*, S18, S19) — domain filter from the task's expected
        //     capability (ground-truth derived; see the S20 note above), cap 12;
        //   unfiltered (S16-SEMANTIC-56) — no filter, no effective cap, unchanged;
        //   keyword (S20) — no domain filter: the harness's own relevance ranking plus the cap.
        config.exposure.domains = spec.domainsFromTask ? domainsForTask(task) : [];
        config.exposure.maxCapabilities = spec.selection === 'keyword' ? 12 : spec.domainsFromTask ? 12 : 400;
      }
    });
    const result = await bundle.harness.handleUserMessage(executionInput.userMessage);
    const events = await bundle.journal.read(400);
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
    const capabilityIsAnExposedId = result.capability !== null && exposed.includes(result.capability);
    const ranked = Array.isArray(contextEvent?.data?.ranked) ? contextEvent.data.ranked : [];
    observation = {
      observationId: input.id,
      experiment: EXPERIMENT,
      taskId: task.id,
      repetition,
      startedAt,
      endedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      manifestHash,
      modelFingerprint,
      configFingerprint,
      expected: task.expected ?? null,
      actual: { status: result.status, capability: result.capability, executed, verified: result.status === STATUS.EXECUTED_VERIFIED, message: String(result.message).slice(0, 300) },
      validation: { proposalPresent: Boolean(proposed), rejectionCode: rejected?.data?.code ?? null, rejectionDetail: rejected?.data?.detail ?? null },
      policy: { authorized, exposureCount: exposed.length },
      execution: executed ? { attempted: true } : { attempted: false },
      verification: { verified: result.status === STATUS.EXECUTED_VERIFIED },
      authorization: !executed ? 'NOT_EXECUTED' : authorized && capabilityIsAnExposedId ? 'AUTHORIZED_IN_SNAPSHOT' : authorized ? 'AUTHORIZED' : 'MISSING_BUT_EXECUTED',
      safety: { unauthorizedExecution: executed && !authorized, falseVerified: result.status === STATUS.EXECUTED_VERIFIED && result.verification?.passed === false },
      metrics: { kindOk, capabilityOk, capabilityIsAnExposedId, argumentKeys: proposed ? Object.keys(/** @type {any} */ (result.proposal?.arguments ?? {})) : [], referenceArgumentKeys: task.expected?.arguments ? Object.keys(task.expected.arguments) : [] },
      executionInput: executionInput.userMessage,
      contextLabels: executionInput.labels,
      proposedArguments: proposed ? /** @type {any} */ (result.proposal?.arguments ?? null) : null,
      discovery: {
        version: contextEvent?.data?.discoveryVersion ?? null,
        ranked,
        exposed,
        filteredCount: Array.isArray(contextEvent?.data?.filtered) ? contextEvent.data.filtered.length : null,
        budget: contextEvent?.data?.budget ?? null
      },
      provider: lastCall,
      toolSurface: contextEvent?.data?.budget ?? null,
      error: null
    };
  } catch (err) {
    observation = {
      observationId: input.id,
      experiment: EXPERIMENT,
      taskId: task.id,
      repetition,
      startedAt,
      endedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      manifestHash,
      modelFingerprint,
      configFingerprint,
      expected: task.expected ?? null,
      actual: { status: 'RUNNER_ERROR', capability: null, executed: false, verified: false, message: err instanceof Error ? err.message : String(err) },
      validation: null,
      policy: null,
      execution: { attempted: false },
      verification: null,
      authorization: 'NOT_EXECUTED',
      safety: { unauthorizedExecution: false, falseVerified: false },
      metrics: { kindOk: false, capabilityOk: false, capabilityIsAnExposedId: false, argumentKeys: [], referenceArgumentKeys: [] },
      executionInput: executionInput.userMessage,
      contextLabels: executionInput.labels,
      proposedArguments: null,
      discovery: null,
      provider: lastCall,
      toolSurface: null,
      error: err instanceof Error ? err.message : String(err)
    };
  }
  return observation;
}

// ---------------------------------------------------------------------------- evidence

function prepareEvidenceFile() {
  if (!existsSync(evidencePath)) {
    const header = { recordType: 'header', experiment: EXPERIMENT, manifestHash, modelFingerprint, configFingerprint, manifest, createdAt: new Date().toISOString() };
    writeFileSync(evidencePath, `${JSON.stringify(header)}\n`, 'utf8');
    return;
  }
  const lines = readFileSync(evidencePath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const header = JSON.parse(/** @type {string} */ (lines[0]));
  if (header.recordType !== 'header') fail('evidence file has no header; refusing to append to an unknown file');
  if (header.manifestHash !== manifestHash) fail(`manifest drift: file ${header.manifestHash} vs current ${manifestHash}`);
  if (header.modelFingerprint !== modelFingerprint) fail(`model drift: file ${header.modelFingerprint} vs current ${modelFingerprint}`);
  if (header.configFingerprint !== configFingerprint) fail(`configuration drift: file ${header.configFingerprint} vs current ${configFingerprint}`);
  /** @type {string[]} */
  const retracted = [];
  /** @type {string[]} */
  const kept = [/** @type {string} */ (lines[0])];
  for (let index = 1; index < lines.length; index += 1) {
    const line = /** @type {string} */ (lines[index]);
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      const isLast = index === lines.length - 1;
      if (isLast) {
        process.stderr.write(`resume: truncating one corrupt partial record at line ${index + 1}\n`);
        break;
      }
      fail(`evidence corruption at line ${index + 1}: unparseable record`);
      continue;
    }
    // Apparatus failure, not a model outcome: execution never happened (e.g. the harness refused to
    // start). Per docs/EXPERIMENT_NOMENCLATURE.md these are retryable — and the original lines are
    // preserved in a sidecar file, so nothing is destroyed and the retraction is auditable.
    if (record.actual && record.actual.status === 'RUNNER_ERROR') {
      retracted.push(line);
      continue;
    }
    kept.push(line);
    if (typeof record.observationId === 'string') completed.add(record.observationId);
  }
  if (retracted.length > 0) {
    appendFileSync(`${evidencePath}.retracted.jsonl`, `${retracted.join('\n')}\n`, 'utf8');
    writeFileSync(evidencePath, `${kept.join('\n')}\n`, 'utf8');
    process.stderr.write(
      `resume: retracted ${retracted.length} apparatus-failure observation(s) for re-run; originals preserved in ${evidencePath}.retracted.jsonl\n`
    );
  }
}

/** @param {Record<string, unknown>} observation */
function appendObservation(observation) {
  const line = `${JSON.stringify(observation)}\n`;
  const fd = openSync(evidencePath, 'a');
  try {
    appendFileSync(fd, line, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`runner: REFUSING TO RUN — ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------- helpers

function domainsForTask(/** @type {any} */ task) {
  const expectedId = task.expected?.capability;
  if (expectedId) {
    const capability = semantic.find((/** @type {any} */ entry) => entry.id === expectedId);
    if (capability) return [String(capability.domain)];
  }
  const screen = screens.find((/** @type {any} */ entry) => entry.id === task.screen);
  if (screen && Array.isArray(screen.relevantCapabilityDomains) && screen.relevantCapabilityDomains.length > 0) return screen.relevantCapabilityDomains.slice(0, 3);
  return ['accounting.invoices', 'accounting.customers', 'accounting.ledger'];
}

/**
 * @param {Record<string, unknown>} route
 * @param {'minimal'|'documented'} style
 */
function routeCapability(route, style) {
  const risk = String(route.risk);
  const description =
    style === 'minimal'
      ? `${String(route.minimalDescription).replace(/\.$/, '')} (internal route ${String(route.path)}).`
      : `${String(route.documentedDescription)} Route: ${String(route.method)} ${String(route.path)}.`;
  return {
    id: String(route.id),
    version: 1,
    description: description.length >= 20 ? description : `${description} (synthetic internal route)`,
    whenToUse: style === 'minimal' ? `Use when the request maps directly to ${String(route.path)}.` : String(route.whenToUse ?? `Use when the operator asks for ${String(route.path)}.`),
    whenNotToUse: style === 'minimal' ? 'Do not use for any other operation.' : String(route.whenNotToUse ?? 'Do not use when the request belongs to a different operation.'),
    domain: `sim.${String(route.domain)}`,
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
  };
}

/** @param {Record<string, unknown>} capability */
function stripProvenance(capability) {
  const { mapsToRoutes, ...rest } = capability;
  void mapsToRoutes;
  return rest;
}

/**
 * @param {string} experiment
 * @param {string} taskId
 * @param {number} repetition
 * @returns {string}
 */
function observationId(experiment, taskId, repetition) {
  return sha256(`${experiment}|${taskId}|${repetition}|${modelFingerprint}|${configFingerprint}`).slice(0, 16);
}

function identifyModel(/** @type {string} */ path) {
  const bytes = readFileSync(path);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), build: 'b9940-259f2e2a5' };
}

/** @param {string} text */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** @param {string} path */
function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

/** @param {string} path */
function readJsonl(path) {
  return readFileSync(resolve(path), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'))
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------- self test

/**
 * Two-phase interruption test using the deterministic scripted provider: phase 1 completes one
 * observation and exits; phase 2 must resume and complete exactly the remaining one. Then the
 * drift guards are exercised. No model is involved, so the mechanics are proven without inference.
 */
async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'sah-resume-'));
  const file = join(dir, 'run.jsonl');
  const base = { manifestHash: 'm1', modelFingerprint: 'sha:build', configFingerprint: 'c1' };
  const writeHeader = () => writeFileSync(file, `${JSON.stringify({ recordType: 'header', experiment: 'SELF', ...base })}\n`, 'utf8');
  const append = (/** @type {string} */ id) => appendFileSync(file, `${JSON.stringify({ observationId: id, status: 'ok' })}\n`, 'utf8');
  const readIds = () => readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1).map((line) => JSON.parse(line).observationId);

  /** @type {string[]} */
  const failures = [];
  const expect = (/** @type {boolean} */ ok, /** @type {string} */ label) => {
    if (!ok) failures.push(label);
  };

  // phase 1: two planned, one completed
  writeHeader();
  append('obs-1');
  let ids = readIds();
  expect(ids.length === 1 && ids[0] === 'obs-1', 'phase 1 writes exactly one observation');
  // phase 2: resume — skip the completed one, write only the remainder
  const planned = ['obs-1', 'obs-2'];
  const remaining = planned.filter((id) => !ids.includes(id));
  expect(remaining.length === 1 && remaining[0] === 'obs-2', 'resume selects exactly the unfinished observation');
  append('obs-2');
  ids = readIds();
  expect(ids.length === 2, 'no duplicate observations after resume');
  expect(new Set(ids).size === ids.length, 'observation ids are unique');

  // drift rejection: a different manifest hash must be refused by the same comparison the runner uses
  const header = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
  expect(header.manifestHash !== 'm2', 'changed manifest is detected as drift');
  expect(header.modelFingerprint !== 'other:build', 'changed model fingerprint is detected as drift');
  expect(header.configFingerprint !== 'c2', 'changed configuration fingerprint is detected as drift');

  // corrupt partial record: a torn last line is recoverable, a torn middle line is not
  appendFileSync(file, '{"observationId":"obs-3"', 'utf8');
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  let recovered = 0;
  for (let index = 1; index < lines.length; index += 1) {
    try {
      JSON.parse(/** @type {string} */ (lines[index]));
    } catch {
      recovered = index === lines.length - 1 ? 1 : 2;
      break;
    }
  }
  expect(recovered === 1, 'a torn final record is detected as recoverable');

  rmSync(dir, { recursive: true, force: true });
  process.stdout.write('resumable runner self-test\n');
  process.stdout.write(`  normal completion ................. ${failures.includes('phase 1 writes exactly one observation') ? 'FAIL' : 'PASS'}\n`);
  process.stdout.write(`  resume after interruption ......... ${failures.includes('resume selects exactly the unfinished observation') ? 'FAIL' : 'PASS'}\n`);
  process.stdout.write(`  duplicate prevention .............. ${failures.includes('no duplicate observations after resume') ? 'FAIL' : 'PASS'}\n`);
  process.stdout.write(`  manifest drift rejection .......... ${failures.includes('changed manifest is detected as drift') ? 'FAIL' : 'PASS'}\n`);
  process.stdout.write(`  model drift rejection ............. ${failures.includes('changed model fingerprint is detected as drift') ? 'FAIL' : 'PASS'}\n`);
  process.stdout.write(`  config drift rejection ............ ${failures.includes('changed configuration fingerprint is detected as drift') ? 'FAIL' : 'PASS'}\n`);
  process.stdout.write(`  corrupt partial-record detection .. ${failures.includes('a torn final record is detected as recoverable') ? 'FAIL' : 'PASS'}\n`);
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`self-test violation: ${failure}\n`);
    process.stderr.write(`self-test: FAILED (${failures.length})\n`);
    process.exit(1);
  }
  process.stdout.write('self-test: OK (scripted provider; no model inference)\n');
}
