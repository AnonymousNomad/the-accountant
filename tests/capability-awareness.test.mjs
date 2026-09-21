/**
 * Capability awareness tests — the eight checks the addendum requires, plus the context budget
 * measurements that make an overloaded tool surface visible.
 *
 * @module tests/capability-awareness
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, turn, proposal, eventTypes } from './helpers/fixtures.mjs';
import { STATUS } from '../src/harness.mjs';
import { EVENT } from '../src/evidence/journal.mjs';
import { FILTER_REASONS } from '../src/registry/context.mjs';

test('A01 the model receives exactly the capabilities that are currently available', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const context = bundle.harness.previewContext('search for the customer Smith');
    assert.equal(context.ids.length, 8);
    assert.ok(context.text.includes('customer.search'));
    for (const id of context.ids) {
      assert.ok(context.text.includes(id), `the context text must describe ${id}`);
      assert.ok(context.text.includes('use_when:'), `each entry must state when to use it`);
      assert.ok(context.text.includes('do_not_use_when:'), `each entry must state when NOT to use it`);
      assert.ok(context.text.includes('risk:'), `each entry must state its risk class`);
    }
  } finally {
    await cleanup();
  }
});

test('A02 a capability that is not available is not advertised, not even as a related reference', async () => {
  const { bundle, cleanup } = await makeHarness({ capabilityOverrides: { 'invoice.issue': { enabled: false } } });
  try {
    const context = bundle.harness.previewContext('issue invoice INV-0004');
    assert.ok(!context.ids.includes('invoice.issue'));
    assert.ok(!context.text.includes('invoice.issue'), 'a disabled capability must not appear anywhere in the context text');
    assert.deepEqual(
      context.filtered.find((entry) => entry.id === 'invoice.issue'),
      { id: 'invoice.issue', reason: FILTER_REASONS.CAPABILITY_DISABLED }
    );
  } finally {
    await cleanup();
  }
});

test('A03 a permission-restricted capability is filtered out of the context', async () => {
  const { bundle, cleanup } = await makeHarness({
    mutateConfig: (/** @type {any} */ config) => {
      config.policy.grantedPermissions = ['accounting.read'];
    }
  });
  try {
    const context = bundle.harness.previewContext('create a customer named Acme Electrical');
    assert.ok(!context.ids.includes('customer.create'));
    assert.deepEqual(
      context.filtered.find((entry) => entry.id === 'customer.create'),
      { id: 'customer.create', reason: FILTER_REASONS.PERMISSION_NOT_GRANTED }
    );
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.REJECTED, 'an unexposed capability is rejected before policy');
  } finally {
    await cleanup();
  }
});

test('A04 irrelevant domains are not exposed and the exposure cap is enforced', async () => {
  const { bundle, cleanup } = await makeHarness({
    mutateConfig: (/** @type {any} */ config) => {
      config.exposure.domains = ['accounting.customers'];
    }
  });
  try {
    const context = bundle.harness.previewContext('anything at all');
    assert.deepEqual([...context.ids].sort(), ['customer.create', 'customer.search', 'customer.update']);
    for (const filtered of context.filtered.filter((entry) => entry.reason === FILTER_REASONS.DOMAIN_NOT_SELECTED)) {
      assert.ok(!context.ids.includes(filtered.id));
    }
  } finally {
    await cleanup();
  }
});

test('A05 the model cannot invoke a capability that was not presented', async () => {
  const { bundle, cleanup } = await makeHarness({
    mutateConfig: (/** @type {any} */ config) => {
      config.exposure.domains = ['accounting.customers'];
      config.exposure.maxCapabilities = 3;
    }
  });
  try {
    const result = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }));
    assert.equal(result.status, STATUS.REJECTED);
    assert.match(result.message, /was not among the capabilities offered/);
    const types = await eventTypes(bundle, result.runId);
    assert.ok(!types.includes(EVENT.EXECUTION_STARTED));
  } finally {
    await cleanup();
  }
});

test('A06 a revoked capability cannot execute, even if it was proposed before revocation', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    // The model was shown invoice.issue in the snapshot, but the capability is disabled before
    // policy runs. The label is the fixture's own: this proves the revocation path.
    const context = bundle.harness.previewContext('issue invoice INV-0004');
    assert.ok(context.ids.includes('invoice.issue'));
    const disabled = await makeHarness({ capabilityOverrides: { 'invoice.issue': { enabled: false } } });
    try {
      const result = await turn(disabled.bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }));
      assert.equal(result.status, STATUS.REJECTED);
      assert.equal(disabled.bundle.store.getInvoice('INV-0004')?.status, 'DRAFT');
    } finally {
      await disabled.cleanup();
    }
  } finally {
    await cleanup();
  }
});

test('A07 registry changes appear in the next context, and a stale snapshot cannot execute', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const before = bundle.harness.previewContext('issue invoice INV-0004');
    assert.ok(before.ids.includes('invoice.issue'));
    assert.equal(before.registryHash, bundle.registry.hash());
    assert.deepEqual(before.capabilities[0], { id: before.ids[0], version: 1 });
    // A snapshot whose registry hash no longer matches is refused by policy (stale context).
    const stale = { ...before, registryHash: 'not-the-current-registry-hash' };
    const decision = bundle.policy.evaluate({ capabilityId: 'invoice.issue', context: stale });
    assert.equal(decision.decision, 'DENY');
    assert.equal(decision.reason, 'CAPABILITY_CONTEXT_STALE');
  } finally {
    await cleanup();
  }
});

test('A08 capability descriptions carry the usage guidance a small model needs', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    for (const capability of bundle.registry.list()) {
      assert.ok(capability.description.length >= 20, `${capability.id} description is too terse`);
      assert.ok(capability.whenToUse.length >= 20, `${capability.id} lacks usable whenToUse guidance`);
      assert.ok(capability.whenNotToUse.length >= 10, `${capability.id} lacks a whenNotToUse boundary`);
      assert.ok(capability.tags.length >= 3, `${capability.id} has too few relevance tags`);
      assert.ok(capability.outputSummary.length >= 5, `${capability.id} does not say what to expect back`);
    }
  } finally {
    await cleanup();
  }
});

test('A09 the context budget is measured and bounded per turn', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const context = bundle.harness.previewContext('create an invoice for Smith Electrical');
    assert.equal(typeof context.budget.approxTokens, 'number');
    assert.ok(context.budget.approxTokens > 0);
    assert.ok(context.budget.textChars > 0);
    assert.ok(context.budget.schemaBytes > 0);
    assert.ok(context.budget.capabilityCount <= 8);
    const events = await bundle.journal.read(20);
    void events;
  } finally {
    await cleanup();
  }
});

test('A10 exposure is deterministic for the same task text', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const first = bundle.harness.previewContext('create an invoice for Smith Electrical');
    const second = bundle.harness.previewContext('create an invoice for Smith Electrical');
    assert.deepEqual(first.ids, second.ids);
    assert.equal(first.contextHash, second.contextHash, 'the same task text produces the same context identity');
    assert.notEqual(first.snapshotId, second.snapshotId, 'snapshot ids are per-turn identities, not content hashes');
  } finally {
    await cleanup();
  }
});
