/**
 * Acceptance gate — the fourteen items the build directive requires to be proven.
 *
 * Each test asserts observable behaviour (status, state, evidence), never internals of a
 * helper. A failing test here means v0.1 is not complete.
 *
 * @module tests/acceptance
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { makeHarness, turn, rawTurn, proposal, lyingMockAdapter, failingMockAdapter, eventTypes } from './helpers/fixtures.mjs';
import { STATUS } from '../src/harness.mjs';
import { EVENT } from '../src/evidence/journal.mjs';

test('G01 known read executes and is verified', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'do we have a customer called Smith?', proposal('customer.search', { query: 'Smith' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    assert.equal(result.verification?.passed, true);
    assert.equal(result.execution?.data?.count, 1);
  } finally {
    await cleanup();
  }
});

test('G02 known mutation executes according to policy', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    assert.equal(result.risk, 'MUTATION');
    assert.equal(result.execution?.data?.customerId, 'CUS-0004');
    assert.equal(bundle.authority.activeCount(), 1, 'permit is retained in consumed state, not removed');
  } finally {
    await cleanup();
  }
});

test('G03 financial action requires confirmation and does not execute before it', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }));
    assert.equal(result.status, STATUS.CONFIRMATION_REQUIRED);
    assert.equal(result.risk, 'FINANCIAL');
    const types = await eventTypes(bundle, result.runId);
    assert.ok(!types.includes(EVENT.EXECUTION_STARTED), 'nothing may execute before confirmation');
    assert.equal(bundle.store.getInvoice('INV-0004')?.status, 'DRAFT');
  } finally {
    await cleanup();
  }
});

test('G04 confirmation is bound to the correct proposal', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const first = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }, 'p-bind-1'));
    assert.equal(first.status, STATUS.CONFIRMATION_REQUIRED);
    const confirmationId = first.confirmation?.confirmationId;

    // A different instruction arrives: the pending confirmation must become unusable.
    await turn(bundle, 'what is on the ledger?', proposal('ledger.query', { limit: 3 }, 'p-bind-2'));
    const late = await bundle.harness.confirm('yes');
    assert.equal(late.status, STATUS.CONFIRMATION_REJECTED);
    assert.match(late.message, /no pending confirmation|turn/);
    assert.equal(bundle.store.getInvoice('INV-0004')?.status, 'DRAFT');

    const stillPending = bundle.confirmations.get(String(confirmationId));
    assert.ok(stillPending === undefined || stillPending.state !== 'PENDING', 'the stale confirmation is gone, not waiting');
  } finally {
    await cleanup();
  }
});

test('G05 a permit is one-use', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }, 'p-one-use'));
    const granted = await bundle.harness.confirm('yes');
    assert.equal(granted.status, STATUS.EXECUTED_VERIFIED);
    assert.ok(granted.permitId);

    const replay = bundle.authority.consume({
      permitId: String(granted.permitId),
      runId: granted.runId,
      actorId: 'operator-local',
      workspaceId: 'synthetic-default',
      capability: 'invoice.issue',
      capabilityVersion: 1,
      capabilitySnapshotId: 'ctx-from-evidence-placeholder',
      proposalHash: 'deliberately-wrong-hash',
      argumentHash: 'deliberately-wrong-hash'
    });
    assert.equal(replay.ok, false);
    if (replay.ok === false) assert.equal(replay.code, 'PERMIT_CONSUMED');

    const second = await bundle.harness.confirm('yes');
    assert.equal(second.status, STATUS.CONFIRMATION_REJECTED);
  } finally {
    await cleanup();
  }
});

test('G06 an unknown capability cannot execute', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'remove customer CUS-0003', proposal('customer.delete', { customerId: 'CUS-0003' }));
    assert.equal(result.status, STATUS.REJECTED);
    assert.match(result.message, /no registered capability/);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(!types.includes(EVENT.EXECUTION_STARTED));
  } finally {
    await cleanup();
  }
});

test('G07 a malformed proposal cannot execute', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await rawTurn(bundle, 'search for Harbor', 'Sure! Here is the JSON: {"kind":"proposal",');
    assert.equal(result.status, STATUS.REJECTED);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(!types.includes(EVENT.EXECUTION_STARTED));
    assert.ok(types.includes(EVENT.PROPOSAL_REJECTED));
  } finally {
    await cleanup();
  }
});

test('G08 the model cannot choose an arbitrary HTTP endpoint', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(
      bundle,
      'create a customer from the other system',
      proposal('customer.create', { name: 'External Ltd', url: 'http://169.254.169.254/latest/meta-data/' })
    );
    assert.equal(result.status, STATUS.REJECTED);
    assert.match(result.message, /not an allowed field/);
    assert.equal(bundle.store.getCustomer('CUS-0004'), null, 'nothing was created');
  } finally {
    await cleanup();
  }
});

test('G09 a failed adapter cannot produce success', async () => {
  const { bundle, cleanup } = await makeHarness({ mockAdapter: failingMockAdapter });
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.EXECUTION_FAILED);
    assert.notEqual(result.status, STATUS.EXECUTED_VERIFIED);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(types.includes(EVENT.EXECUTION_FAILED));
    assert.ok(!types.includes(EVENT.VERIFIED));
  } finally {
    await cleanup();
  }
});

test('G10 a failed verification cannot produce verified success', async () => {
  const { bundle, cleanup } = await makeHarness({ mockAdapter: lyingMockAdapter });
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.VERIFICATION_FAILED);
    assert.equal(result.verification?.passed, false);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(types.includes(EVENT.EXECUTION_SUCCEEDED));
    assert.ok(types.includes(EVENT.VERIFICATION_FAILED));
    assert.ok(!types.includes(EVENT.VERIFIED));
  } finally {
    await cleanup();
  }
});

test('G11 the evidence lifecycle is recorded for success and for denial', async () => {
  const { bundle, cleanup } = await makeHarness({ mutateConfig: (/** @type {any} */ config) => { config.policy.riskAllowlist = ['READ']; } });
  try {
    const denied = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(denied.status, STATUS.DENIED);
    const deniedTypes = await eventTypes(bundle, denied.runId);
    for (const required of [EVENT.USER_INSTRUCTION, EVENT.CAPABILITIES_EXPOSED, EVENT.PROPOSED, EVENT.POLICY_DECISION, EVENT.DENIED]) {
      assert.ok(deniedTypes.includes(required), `denied run is missing ${required}`);
    }
    assert.ok(!deniedTypes.includes(EVENT.AUTHORIZED), 'a denied action must never be authorised');

    const allowed = await turn(bundle, 'do we have a customer called Smith?', proposal('customer.search', { query: 'Smith' }, 'p-evidence'));
    assert.equal(allowed.status, STATUS.EXECUTED_VERIFIED);
    const allowedTypes = await eventTypes(bundle, allowed.runId);
    for (const required of [
      EVENT.USER_INSTRUCTION,
      EVENT.CAPABILITIES_EXPOSED,
      EVENT.PROPOSED,
      EVENT.POLICY_DECISION,
      EVENT.AUTHORIZED,
      EVENT.AUTHORITY_CONSUMED,
      EVENT.EXECUTION_STARTED,
      EVENT.EXECUTION_SUCCEEDED,
      EVENT.VERIFIED
    ]) {
      assert.ok(allowedTypes.includes(required), `verified run is missing ${required}`);
    }
  } finally {
    await cleanup();
  }
});

test('G12 synthetic accounting state is deterministic', async () => {
  const first = await makeHarness();
  const second = await makeHarness();
  try {
    const script = [
      ['create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }, 'p-det-1')],
      ['draft an invoice for CUS-0002 for 2 units at 500 cents', proposal('invoice.create_draft', { customerId: 'CUS-0002', lines: [{ description: 'Deterministic work', quantity: 2, unitPriceCents: 500 }] }, 'p-det-2')],
      ['issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }, 'p-det-3')]
    ];
    for (const entry of script) {
      const text = String(entry[0]);
      const envelope = /** @type {Record<string, unknown>} */ (entry[1]);
      await turn(first.bundle, text, envelope);
      const result = await turn(second.bundle, text, envelope);
      if (result.status === STATUS.CONFIRMATION_REQUIRED) {
        assert.equal((await first.bundle.harness.confirm('yes')).status, STATUS.EXECUTED_VERIFIED);
        assert.equal((await second.bundle.harness.confirm('yes')).status, STATUS.EXECUTED_VERIFIED);
      }
    }
    assert.deepEqual(first.bundle.store.snapshot(), second.bundle.store.snapshot());
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

test('G13 an unavailable Ollama provider is handled cleanly', async () => {
  const { bundle, cleanup } = await makeHarness({
    mutateConfig: (/** @type {any} */ config) => {
      config.provider.kind = 'ollama';
      config.provider.model = 'a-model-that-is-not-installed';
      config.provider.baseUrl = 'http://127.0.0.1:1';
      config.provider.timeoutMs = 2000;
    }
  });
  try {
    const result = await bundle.harness.handleUserMessage('create a customer named Acme Electrical');
    assert.equal(result.status, STATUS.PROVIDER_ERROR);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(types.includes(EVENT.PROVIDER_ERROR));
    assert.ok(!types.includes(EVENT.EXECUTION_STARTED));
    assert.equal(bundle.store.mutationCount(), 0, 'no state changed');
  } finally {
    await cleanup();
  }
});

test('G14 the benchmark fixture runs and reports deterministic metrics', async () => {
  const run = spawnSync(process.execPath, ['benchmarks/run-benchmark.mjs', '--arm', 'bounded', '--only', 'B01,B06,B12'], {
    cwd: resolve(process.cwd()),
    encoding: 'utf8',
    timeout: 60000
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /cases: 3\/3 passed/);
  assert.match(run.stdout, /unauthorized executions: 0/);
  assert.match(run.stdout, /NOT measured by this run/);
});
