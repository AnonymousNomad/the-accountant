/**
 * Verification tests: the difference between an executed action and a verified one.
 *
 * @module tests/verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifierRegistry, check } from '../src/evidence/verifier.mjs';
import { makeHarness, turn, proposal, rawTurn } from './helpers/fixtures.mjs';
import { STATUS } from '../src/harness.mjs';

test('a verifier that throws is a failure, not a pass', () => {
  const registry = createVerifierRegistry();
  registry.register('demo.throws', () => {
    throw new Error('verifier exploded');
  });
  const outcome = registry.run({
    verifierId: 'demo.throws',
    capability: /** @type {any} */ ({}),
    proposal: {},
    arguments: {},
    execution: { ok: true, data: {} }
  });
  assert.equal(outcome.passed, false);
  assert.match(String(outcome.checks[0].detail), /verifier exploded/);
});

test('a verifier that produces no checks is not a pass', () => {
  const registry = createVerifierRegistry();
  registry.register('demo.empty', () => ({ checks: [] }));
  const outcome = registry.run({
    verifierId: 'demo.empty',
    capability: /** @type {any} */ ({}),
    proposal: {},
    arguments: {},
    execution: { ok: true, data: {} }
  });
  assert.equal(outcome.passed, false);
  assert.match(String(outcome.checks[0].detail), /empty verification is not a pass/);
});

test('an unregistered verifier is refused with a clear reason', () => {
  const registry = createVerifierRegistry();
  const outcome = registry.run({
    verifierId: 'demo.missing',
    capability: /** @type {any} */ ({}),
    proposal: {},
    arguments: {},
    execution: { ok: true, data: {} }
  });
  assert.equal(outcome.passed, false);
  assert.match(String(outcome.checks[0].detail), /no verifier registered/);
});

test('a verifier that reports one failing check fails the whole verification', () => {
  const registry = createVerifierRegistry();
  registry.register('demo.mixed', () => ({
    checks: [check('exists', true), check('matches', false, 'the stored value differs')]
  }));
  const outcome = registry.run({
    verifierId: 'demo.mixed',
    capability: /** @type {any} */ ({}),
    proposal: {},
    arguments: {},
    execution: { ok: true, data: {} }
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.checks.length, 2);
});

test('a lying adapter is caught: the reported id does not exist in the store', async () => {
  const { bundle, cleanup } = await makeHarness({
    mockAdapter: {
      kind: 'mock',
      enabled: true,
      has: () => true,
      execute: () => ({ ok: true, data: { customerId: 'CUS-9999', name: 'Acme Electrical', email: 'x@y.z', version: 1 } })
    }
  });
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.VERIFICATION_FAILED);
    const failed = result.verification?.checks.filter((entry) => entry.ok === false) ?? [];
    assert.ok(failed.some((entry) => entry.check === 'customer_exists'), 'the failing check is identified');
    assert.equal(bundle.store.getCustomer('CUS-9999'), null);
  } finally {
    await cleanup();
  }
});

test('a read is verified by re-reading the same deterministic state', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'preview invoice INV-0004', proposal('invoice.preview', { invoiceId: 'INV-0004' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    const checks = result.verification?.checks.map((entry) => entry.check) ?? [];
    assert.deepEqual(checks.sort(), ['read_reproduced', 'result_shape']);
  } finally {
    await cleanup();
  }
});

test('verification cannot be skipped by a malformed or missing proposal', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await rawTurn(bundle, 'do something odd', '{"kind":"proposal","proposalId":"p-x","capability":"invoice.issue","arguments":{},"reasoningSummary":"missing invoice id"}');
    assert.equal(result.status, STATUS.REJECTED);
    assert.equal(result.verification, null);
  } finally {
    await cleanup();
  }
});
