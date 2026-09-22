/**
 * Benchmark discipline tests: the fixture covers the required classes, the runner's report is
 * complete, and the two arms differ in a way that is measured rather than asserted.
 *
 * @module tests/benchmark
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FAILURE_TAXONOMY } from '../benchmarks/run-benchmark.mjs';
import { STATUS } from '../src/harness.mjs';

const FIXTURE = resolve(process.cwd(), 'benchmarks/prompts.jsonl');
const CLOSED_STATUSES = Object.values(STATUS);

function loadFixture() {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'))
    .map((/** @type {string} */ line) => JSON.parse(line));
}

function runArm(/** @type {string} */ arm, /** @type {string[]} */ extra = []) {
  const run = spawnSync(process.execPath, ['benchmarks/run-benchmark.mjs', '--arm', arm, ...extra], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120000
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  // Read exactly the report this run wrote, from the path the runner itself prints. Scanning the
  // results directory for the newest name is not isolated: concurrent runs, and non-monotonic clock
  // names (a backward system-time correction), can hand back a different run's report.
  const printed = [...run.stdout.matchAll(/^report: (.+)$/gm)];
  assert.ok(printed.length > 0, `the runner must print its report path; stdout was: ${run.stdout}`);
  const reportPath = /** @type {string} */ (printed[printed.length - 1][1]).trim();
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

test('the fixture has at least 25 cases and covers every required class', () => {
  const fixture = loadFixture();
  assert.ok(fixture.length >= 25, `expected >= 25 cases, found ${fixture.length}`);
  const categories = new Set(fixture.map((entry) => entry.category));
  for (const required of [
    'normal_read',
    'customer_create',
    'invoice_draft',
    'invoice_issue',
    'missing_required_information',
    'ambiguous_request',
    'nonexistent_capability_request',
    'malformed_model_output',
    'unauthorized_financial_action',
    'confirmation',
    'replayed_confirmation',
    'hallucinated_capability',
    'unsupported_operation',
    'invalid_arguments',
    'domain_refusal'
  ]) {
    assert.ok(categories.has(required), `the fixture must cover ${required}`);
  }
});

test('every expectation is written against the closed status set and the fixed failure taxonomy', () => {
  for (const entry of /** @type {any[]} */ (loadFixture())) {
    assert.ok(Array.isArray(entry.turns) && entry.turns.length > 0, `${entry.id} must have turns`);
    for (const turn of entry.turns) {
      const expect = turn.expect ?? {};
      if (expect.status !== undefined) {
        assert.ok(CLOSED_STATUSES.includes(expect.status), `${entry.id} expects unknown status ${expect.status}`);
      }
      if (expect.failureClass !== undefined) {
        assert.ok(FAILURE_TAXONOMY.includes(expect.failureClass), `${entry.id} uses unknown failure class ${expect.failureClass}`);
      }
      const hasModel = turn.model !== undefined || turn.modelRaw !== undefined;
      const isConfirm = turn.confirm !== undefined;
      assert.ok(hasModel !== isConfirm, `${entry.id} turn must be either a model turn or a confirmation turn`);
    }
  }
});

test('the bounded arm passes the fixture with zero unsafe executions', () => {
  const report = runArm('bounded');
  assert.equal(report.metrics.endToEndCompletion.passed, report.cases.length, JSON.stringify(report.metrics.failuresByClassification));
  assert.equal(report.metrics.unauthorizedExecutions, 0);
  assert.equal(report.metrics.expectationsMet, report.metrics.expectationsChecked);
});

test('the report records everything a later comparison needs, and claims nothing about the model', () => {
  const report = runArm('bounded', ['--only', 'B01,B12']);
  for (const field of ['benchmarkVersion', 'runAt', 'command', 'arm', 'environment', 'harness', 'provider', 'fixture', 'contextBudget', 'metrics', 'latencyMs', 'unmeasured', 'contaminationDeclaration', 'cases']) {
    assert.ok(field in report, `the report must include ${field}`);
  }
  assert.match(report.fixture.hash, /^[0-9a-f]{64}$/);
  assert.ok(report.harness.configHash && report.harness.registryHash && report.harness.sopHash, 'hashes pin the run identity');
  assert.equal(report.provider.backend, 'fixture replay (no inference performed)');
  assert.ok(report.unmeasured.some((/** @type {string} */ entry) => /model selection accuracy/.test(entry)), 'the report must state what it does not measure');
  assert.ok(report.latencyMs.p50 !== null && report.latencyMs.p90 !== null, 'latency percentiles are reported');
  assert.equal(report.latencyMs.warmUpMs === null, false, 'the warm-up turn is reported separately');
  assert.ok(report.cases[0].turns[0].context !== undefined, 'per-turn context observability is preserved');
});

test('the overloaded arm exposes more context than the bounded arm — a measured difference, not a claimed improvement', () => {
  const bounded = runArm('bounded', ['--only', 'B01']);
  const overloaded = runArm('overloaded', ['--only', 'B01', '--filler', '40']);
  assert.equal(overloaded.contextBudget.fillerCapabilities, 40);
  assert.ok(
    overloaded.contextBudget.meanApproxTokens > bounded.contextBudget.meanApproxTokens,
    'an overloaded surface must be measurably larger'
  );
  assert.ok(
    overloaded.contextBudget.meanCapabilities > bounded.contextBudget.meanCapabilities,
    'an overloaded surface must expose more capabilities'
  );
  assert.equal(overloaded.metrics.unauthorizedExecutions, 0);
  assert.deepEqual(overloaded.unmeasured, bounded.unmeasured, 'neither arm claims model-quality measurements');
});
