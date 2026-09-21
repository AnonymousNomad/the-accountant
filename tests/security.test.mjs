/**
 * Fail-closed security matrix — the eleven probes the build directive requires.
 *
 * Every test here asserts a REFUSAL: a typed failure, no execution, no state change, and no
 * success-shaped status. If any of these tests ever passes while allowing an effect, the
 * harness has lost the property it exists to provide.
 *
 * @module tests/security
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, turn, proposal, eventTypes } from './helpers/fixtures.mjs';
import { STATUS } from '../src/harness.mjs';
import { EVENT } from '../src/evidence/journal.mjs';

test('S01 unknown capability is refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'drop the customers table', proposal('customer.drop', { table: 'customers' }));
    assert.equal(result.status, STATUS.REJECTED);
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('S02 malformed proposal is refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'do something', proposal('customer.create', /** @type {any} */ ('not-an-object')));
    assert.equal(result.status, STATUS.REJECTED);
    assert.ok((await eventTypes(bundle, result.runId)).includes(EVENT.PROPOSAL_REJECTED));
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('S03 invalid arguments are refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'issue the fourth invoice', proposal('invoice.issue', { invoiceId: 'the fourth one' }));
    assert.equal(result.status, STATUS.REJECTED);
    assert.match(result.message, /must match|must be at most/);
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('S04 permit binding is enforced (argument, actor, workspace, version and snapshot substitution)', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const binding = {
      policyDecision: 'ALLOW',
      runId: 'run-s04',
      actorId: 'operator-local',
      workspaceId: 'synthetic-default',
      capability: 'invoice.issue',
      capabilityVersion: 1,
      capabilitySnapshotId: 'ctx-s04',
      risk: 'FINANCIAL',
      proposalHash: 'hash-approved',
      argumentHash: 'args-approved'
    };
    /** @type {Array<[string, Record<string, unknown>]>} */
    const attempts = [
      ['PROPOSAL_MISMATCH', { proposalHash: 'hash-substituted' }],
      ['PROPOSAL_MISMATCH', { argumentHash: 'args-substituted' }],
      ['ACTOR_MISMATCH', { actorId: 'someone-else' }],
      ['WORKSPACE_MISMATCH', { workspaceId: 'another-workspace' }],
      ['CAPABILITY_VERSION_MISMATCH', { capabilityVersion: 2 }],
      ['SNAPSHOT_MISMATCH', { capabilitySnapshotId: 'ctx-later' }],
      ['CAPABILITY_MISMATCH', { capability: 'customer.create' }],
      ['RUN_MISMATCH', { runId: 'run-other' }]
    ];
    for (const [expectedCode, substitution] of attempts) {
      const permit = bundle.authority.issue(binding);
      const consume = bundle.authority.consume({ permitId: permit.permitId, ...binding, ...substitution });
      assert.equal(consume.ok, false, `${expectedCode}: consumption must be refused`);
      assert.equal(consume.code, expectedCode);
    }
    const good = bundle.authority.issue(binding);
    assert.equal(bundle.authority.consume({ permitId: good.permitId, ...binding }).ok, true);
  } finally {
    await cleanup();
  }
});

test('S06 expired authority is refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const binding = {
      policyDecision: 'ALLOW',
      runId: 'run-s06',
      actorId: 'operator-local',
      workspaceId: 'synthetic-default',
      capability: 'invoice.issue',
      capabilityVersion: 1,
      capabilitySnapshotId: 'ctx-s06',
      risk: 'FINANCIAL',
      proposalHash: 'hash-s06',
      argumentHash: 'args-s06'
    };
    const permit = bundle.authority.issue(binding);
    /** @type {any} */ (bundle.clock).advance(61_000);
    const consume = bundle.authority.consume({ permitId: permit.permitId, ...binding });
    assert.equal(consume.ok, false);
    assert.equal(consume.code, 'PERMIT_EXPIRED');
  } finally {
    await cleanup();
  }
});

test('S05 permit reuse is refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }, 'p-reuse'));
    const granted = await bundle.harness.confirm('yes');
    assert.equal(granted.status, STATUS.EXECUTED_VERIFIED);

    const events = await bundle.journal.read(50);
    const proposed = events.find((event) => event.type === EVENT.PROPOSED && event.runId === result.runId);
    const authorized = events.find((event) => event.type === EVENT.AUTHORIZED && event.runId === granted.runId);
    assert.ok(proposed && authorized, 'the run must have recorded PROPOSED and AUTHORIZED');

    const reuse = bundle.authority.consume({
      permitId: String(granted.permitId),
      runId: granted.runId,
      actorId: String(authorized.data.actorId),
      workspaceId: String(authorized.data.workspaceId),
      capability: 'invoice.issue',
      capabilityVersion: Number(authorized.data.capabilityVersion),
      capabilitySnapshotId: String(authorized.data.capabilitySnapshotId),
      proposalHash: String(proposed.proposalHash),
      argumentHash: String(authorized.data.argumentHash)
    });
    assert.equal(reuse.ok, false);
    assert.equal(reuse.code, 'PERMIT_CONSUMED');

    const secondConfirm = await bundle.harness.confirm('yes');
    assert.equal(secondConfirm.status, STATUS.CONFIRMATION_REJECTED);
  } finally {
    await cleanup();
  }
});

test('S07 confirmation mismatch is refused and a replay after use is refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }, 'p-conf-mismatch'));
    assert.equal(result.status, STATUS.CONFIRMATION_REQUIRED);
    const unclear = await bundle.harness.confirm('hmm, maybe');
    assert.equal(unclear.status, STATUS.CONFIRMATION_REJECTED);
    const granted = await bundle.harness.confirm('yes');
    assert.equal(granted.status, STATUS.EXECUTED_VERIFIED);
    const replay = await bundle.harness.confirm('yes');
    assert.equal(replay.status, STATUS.CONFIRMATION_REJECTED);
  } finally {
    await cleanup();
  }
});

test('S08 an unsupported operation is refused without approximation', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'transfer $20,000 to this bank account', {
      kind: 'unsupported',
      reason: 'No registered capability can transfer funds between accounts.',
      reasoningSummary: 'No capability moves money in this harness.'
    });
    assert.equal(result.status, STATUS.UNSUPPORTED);
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('S09 adapter failure is refused (never success)', async () => {
  const { bundle, cleanup } = await makeHarness({
    mockAdapter: { kind: 'mock', enabled: true, has: () => true, execute: () => ({ ok: false, code: 'ADAPTER_ERROR', detail: 'boom' }) }
  });
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.EXECUTION_FAILED);
    assert.notEqual(result.status, STATUS.EXECUTED_VERIFIED);
    assert.equal(bundle.store.getCustomer('CUS-0004'), null);
  } finally {
    await cleanup();
  }
});

test('S10 verifier failure is refused (never verified success)', async () => {
  const { bundle, cleanup } = await makeHarness({
    mockAdapter: { kind: 'mock', enabled: true, has: () => true, execute: () => ({ ok: true, data: { customerId: 'CUS-0004', name: 'Untrue', email: 'x@y.z', version: 1 } }) }
  });
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.VERIFICATION_FAILED);
    assert.equal(result.verification?.passed, false);
    assert.ok(result.verification?.checks.some((check) => check.ok === false));
  } finally {
    await cleanup();
  }
});

test('S11 Ollama unavailable is refused (no proposal, no execution)', async () => {
  const { bundle, cleanup } = await makeHarness({
    mutateConfig: (/** @type {any} */ config) => {
      config.provider.kind = 'ollama';
      config.provider.model = 'absent-model';
      config.provider.baseUrl = 'http://127.0.0.1:1';
      config.provider.timeoutMs = 1500;
    }
  });
  try {
    const result = await bundle.harness.handleUserMessage('create a customer named Acme Electrical');
    assert.equal(result.status, STATUS.PROVIDER_ERROR);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(!types.includes(EVENT.PROPOSED));
    assert.ok(!types.includes(EVENT.EXECUTION_STARTED));
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('S12 the model cannot assert a risk class or permission of its own', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const withRisk = await turn(bundle, 'issue invoice INV-0004', {
      kind: 'proposal',
      proposalId: 'p-risk',
      capability: 'invoice.issue',
      arguments: { invoiceId: 'INV-0004' },
      risk: 'READ',
      requiresConfirmation: false,
      reasoningSummary: 'Attempting to lower the risk class.'
    });
    assert.equal(withRisk.status, STATUS.REJECTED);
    assert.match(withRisk.message, /not an allowed field|must not contain/);

    const withPermission = await turn(bundle, 'issue invoice INV-0004', {
      kind: 'proposal',
      proposalId: 'p-perm',
      capability: 'invoice.issue',
      arguments: { invoiceId: 'INV-0004' },
      requiredPermissions: [],
      reasoningSummary: 'Attempting to assert permissions.'
    });
    assert.equal(withPermission.status, STATUS.REJECTED);
  } finally {
    await cleanup();
  }
});

test('S13 a capability outside the exposed context is refused even if it exists', async () => {
  const { bundle, cleanup } = await makeHarness({
    mutateConfig: (/** @type {any} */ config) => {
      config.exposure.domains = ['accounting.customers'];
      config.exposure.maxCapabilities = 12;
    }
  });
  try {
    const result = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }));
    assert.equal(result.status, STATUS.REJECTED);
    assert.match(result.message, /was not among the capabilities offered/);
    assert.equal(bundle.store.getInvoice('INV-0004')?.status, 'DRAFT');
    const types = await eventTypes(bundle, result.runId);
    assert.ok(types.includes(EVENT.PROPOSAL_REJECTED));
  } finally {
    await cleanup();
  }
});

test('S14 a replayed proposalId in one session is refused', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const first = await turn(bundle, 'do we have a customer called Smith?', proposal('customer.search', { query: 'Smith' }, 'p-replay'));
    assert.equal(first.status, STATUS.EXECUTED_VERIFIED);
    const second = await turn(bundle, 'do we have a customer called Harbor?', proposal('customer.search', { query: 'Harbor' }, 'p-replay'));
    assert.equal(second.status, STATUS.REJECTED);
    assert.match(second.message, /already used/);
  } finally {
    await cleanup();
  }
});

test('S15 a non-loopback provider or adapter host is refused at startup', async () => {
  await assert.rejects(
    () =>
      makeHarness({
        mutateConfig: (/** @type {any} */ config) => {
          config.provider.kind = 'ollama';
          config.provider.model = 'a-model';
          config.provider.baseUrl = 'http://example.com:11434';
        }
      }),
    /not loopback/
  );
});
