/**
 * CLI tests: the operator transcript is derived strictly from the status, exit codes are
 * meaningful, and the three transcript scenarios from the build directive run end to end.
 *
 * @module tests/cli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { render, exitCodeFor, describeContext } from '../src/cli.mjs';
import { STATUS } from '../src/harness.mjs';

test('the transcript never claims success for anything but a verified execution', () => {
  /** @type {string[]} */ const messages = [];
  const original = process.stdout.write.bind(process.stdout);
  /** @type {any} */ (process.stdout).write = (/** @type {any} */ chunk) => {
    messages.push(String(chunk));
    return true;
  };
  try {
    for (const status of Object.values(STATUS)) {
      messages.length = 0;
      render({
        status,
        message: 'fixture message',
        runId: 'run-1',
        capability: 'invoice.issue',
        risk: 'FINANCIAL',
        evidence: { seqs: [1, 2], lastSeq: 3 },
        timingsMs: { total: 5, provider: 1 },
        execution: { ok: true, data: { customerId: 'CUS-0004' } }
      });
      const text = messages.join('');
      if (status === 'EXECUTED_VERIFIED') {
        assert.match(text, /Executed/);
        assert.match(text, /Verified/);
      } else {
        assert.doesNotMatch(text, /^Executed$/m, `${status} must not print an unqualified Executed line`);
        assert.doesNotMatch(text, /^Verified$/m, `${status} must not print an unqualified Verified line`);
      }
      if (status === 'UNSUPPORTED') {
        assert.match(text, /No registered capability can perform that operation/);
        assert.match(text, /No execution occurred/);
      }
      if (status === 'COMMIT_UNKNOWN') {
        assert.match(text, /NOT retried/);
        assert.match(text, /may or may not have reached/);
      }
      if (status === 'VERIFICATION_FAILED') {
        assert.match(text, /No success is claimed/);
      }
    }
  } finally {
    /** @type {any} */ (process.stdout).write = original;
  }
});

test('exit codes distinguish determinate outcomes, failures and unavailable runtimes', () => {
  assert.equal(exitCodeFor('EXECUTED_VERIFIED', false), 0);
  assert.equal(exitCodeFor('CLARIFICATION_REQUIRED', false), 0);
  assert.equal(exitCodeFor('UNSUPPORTED', false), 0);
  assert.equal(exitCodeFor('CONFIRMATION_REQUIRED', false), 0);
  assert.equal(exitCodeFor('DENIED', false), 1);
  assert.equal(exitCodeFor('REJECTED', false), 1);
  assert.equal(exitCodeFor('EXECUTION_FAILED', false), 1);
  assert.equal(exitCodeFor('VERIFICATION_FAILED', false), 1);
  assert.equal(exitCodeFor('COMMIT_UNKNOWN', false), 1);
  assert.equal(exitCodeFor('EVIDENCE_ERROR', false), 1);
  assert.equal(exitCodeFor('PROVIDER_ERROR', false), 2);
});

test('the capability preview explains exactly what a small model would receive', () => {
  const text = describeContext({
    ids: ['customer.search', 'customer.create'],
    filtered: [{ id: 'invoice.issue', reason: 'CAPABILITY_DISABLED' }],
    budget: { capabilityCount: 2, textChars: 100, approxTokens: 25, schemaBytes: 200 },
    registrySize: 8,
    registryHash: 'a'.repeat(64),
    contextHash: 'b'.repeat(64)
  });
  assert.match(text, /exposed \(2 of 8\)/);
  assert.match(text, /invoice\.issue:CAPABILITY_DISABLED/);
  assert.match(text, /≈ 25 tokens/);
});

test('the three directive scenarios run end to end through the CLI', () => {
  const cases = [
    { prompt: 'create a customer named Acme Electrical', expect: /Executed[\s\S]*Verified/, code: 0 },
    { prompt: 'issue invoice INV-0004', expect: /Confirmation required\./, code: 0 },
    { prompt: 'transfer $20,000 to this bank account', expect: /No registered capability can perform that operation\.[\s\S]*No execution occurred\./, code: 0 }
  ];
  for (const entry of /** @type {any[]} */ (cases)) {
    const run = spawnSync(
      process.execPath,
      ['src/cli.mjs', '--provider', 'scripted', '--script', 'fixtures/demo-script.jsonl', '--prompt', entry.prompt],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 }
    );
    assert.equal(run.status, entry.code, `${entry.prompt}: ${run.stderr}`);
    assert.match(run.stdout, entry.expect);
  }
});

test('the financial scenario executes exactly once when the operator confirms', () => {
  const run = spawnSync(
    process.execPath,
    ['src/cli.mjs', '--provider', 'scripted', '--script', 'fixtures/demo-script.jsonl', '--prompt', 'issue invoice INV-0004', '--confirm'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Proposed: invoice\.issue/);
  assert.match(run.stdout, /Risk: FINANCIAL/);
  assert.match(run.stdout, /Authority: one-use permit issued and consumed/);
  assert.match(run.stdout, /Executed/);
  assert.match(run.stdout, /Verified/);
  assert.match(run.stdout, /"status":"ISSUED"/);
});

test('an unavailable runtime exits with the documented code and never invents a proposal', () => {
  const run = spawnSync(
    process.execPath,
    ['src/cli.mjs', '--provider', 'ollama', '--prompt', 'create a customer named Acme Electrical'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(run.status, 2);
  assert.match(run.stderr, /cannot start/);
  assert.doesNotMatch(run.stdout, /Executed/);
});
