/**
 * Anti-leak boundary tests (S19 defect → Phase 2 repair).
 *
 * The S19 diagnosis found that bounded discovery had been derived from the task's *expected*
 * capability: the scoring answer decided which tools the model was shown. These tests make that
 * class of leak fail loudly and permanently.
 *
 * @module tests/anti-leak
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_EXECUTION_FIELDS,
  ExecutionBoundaryError,
  assertConfigTruth,
  buildExecutionInput,
  effectiveConfigFingerprint,
  executionTaskOf
} from '../benchmarks/execution-input.mjs';

const RAW_TASK = Object.freeze({
  id: 'T999',
  category: 'Quotes/Invoices',
  difficulty: 'medium',
  text: 'Issue the draft for the customer we discussed.',
  screen: 'invoice.detail',
  entity: 'INV-00482',
  jurisdiction: 'NZ',
  expected: { kind: 'proposal', capability: 'invoice.issue', arguments: { invoiceId: 'INV-00482' }, notes: 'scoring truth' }
});

test('projection keeps only execution-visible fields', () => {
  const projected = executionTaskOf(RAW_TASK);
  assert.deepEqual(Object.keys(projected).sort(), [...ALLOWED_EXECUTION_FIELDS].sort());
  assert.equal(projected.text, RAW_TASK.text);
  assert.equal('expected' in projected, false, 'scoring truth is dropped by projection');
});

test('execution refuses to run when scoring truth is present (fail closed)', () => {
  assert.throws(() => buildExecutionInput(RAW_TASK), ExecutionBoundaryError);
  assert.throws(() => buildExecutionInput(RAW_TASK), /scoring truth "expected"/);
  assert.throws(() => buildExecutionInput({ text: 'x', answer: 'invoice.issue' }), /scoring truth "answer"/);
  assert.throws(() => buildExecutionInput({ text: 'x', unexpectedBookkeeping: 1 }), /unknown field "unexpectedBookkeeping"/);
});

test('the composed user message carries trusted context and never the expected answer', () => {
  const input = buildExecutionInput(executionTaskOf(RAW_TASK));
  assert.match(input.userMessage, /\[context: screen=invoice\.detail selected=INV-00482 jurisdiction=NZ\]/);
  assert.match(input.userMessage, /Issue the draft for the customer we discussed\./);
  assert.ok(!input.userMessage.includes('invoice.issue'), 'the expected capability must never appear in execution input');
  assert.ok(!input.textForDiscovery.includes('invoice.issue'), 'nor in the discovery signals derived from execution input');
  assert.ok(
    input.textForDiscovery.includes('invoice.detail') && input.textForDiscovery.includes('NZ'),
    'trusted context is a legitimate discovery signal'
  );
});

test('tasks without context produce an unadorned message', () => {
  const input = buildExecutionInput(executionTaskOf({ id: 'T1', text: 'Find Smith Electrical.' }));
  assert.equal(input.userMessage, 'Find Smith Electrical.');
});

test('effective configuration is fingerprinted from the loaded configuration, and mismatch is refused', () => {
  const configA = { provider: { model: 'a' }, policy: { grantedPermissions: ['accounting.read'] } };
  const configB = { provider: { model: 'a' }, policy: { grantedPermissions: ['accounting.read', 'payroll.read'] } };
  assert.notEqual(effectiveConfigFingerprint(configA), effectiveConfigFingerprint(configB), 'a permission change changes the fingerprint');

  assert.equal(
    assertConfigTruth({ requestedPath: 'config/a.json', specPath: 'config/a.json', loadedPath: 'config/a.json', effectiveConfig: configA }),
    effectiveConfigFingerprint(configA)
  );
  assert.throws(
    () => assertConfigTruth({ requestedPath: 'config/b.json', specPath: 'config/a.json', loadedPath: 'config/b.json', effectiveConfig: configB }),
    /configuration truth violation/
  );
});
