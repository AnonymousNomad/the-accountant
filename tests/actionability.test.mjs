/**
 * Actionability tests (S19) — RETRIEVE BEFORE CLARIFY.
 *
 * The S18 evidence showed the Resident asking the user for values that exposed capabilities exist
 * to retrieve (dominant failure: over-clarification of retrievable information). The repair is a
 * general decision procedure in the model-facing material, not task-specific coaching. These tests
 * prove two things:
 *   1. the procedure is present, general, and reaches the model in the assembled system prompt;
 *   2. every branch of that procedure is supported by the harness — a resolver returns identifiers,
 *      ambiguity is surfaced rather than guessed, a non-retrievable required value is refused until
 *      supplied, a jurisdiction is enum-restricted, and an unsupported operation is refused rather
 *      than turned into a question.
 *
 * The model's *decision* cannot be tested without inference; what is testable is that the system
 * makes each decision possible and refuses the unsafe shortcuts.
 *
 * @module tests/actionability
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeHarness, turn, proposal } from './helpers/fixtures.mjs';
import { STATUS } from '../src/harness.mjs';
import { buildSystemPrompt, loadSop } from '../src/models/prompt.mjs';

const SOP_PATH = 'prompts/accounting-resident.sop.md';
const DOCTRINE_PATH = 'prompts/accountants-way.compact.md';

test('the retrieve-before-clarify procedure is present in the SOP, the doctrine and the response contract', () => {
  const sop = readFileSync(SOP_PATH, 'utf8');
  const doctrine = readFileSync(DOCTRINE_PATH, 'utf8');
  for (const label of ['MISSING BUT RETRIEVABLE', 'MISSING AND NOT RETRIEVABLE', 'AMBIGUOUS', 'CONSEQUENTIALLY AMBIGUOUS']) {
    assert.ok(sop.includes(label), `the SOP must classify gaps as ${label}`);
  }
  assert.match(sop, /RETRIEVE BEFORE CLARIFY/);
  assert.match(sop, /RETRIEVABLE WITH AN EXPOSED CAPABILITY/);
  assert.match(doctrine, /CLARIFY only what cannot be retrieved/i, 'the doctrine must carry the same discipline in compact form');

  const assembled = buildSystemPrompt({
    sopText: readFileSync(SOP_PATH, 'utf8'),
    baseContractText: readFileSync('prompts/resident-base-contract.md', 'utf8'),
    doctrineText: doctrine,
    contextText: '<a capability list>'
  });
  assert.match(assembled, /RETRIEVE BEFORE CLARIFY/, 'the procedure reaches the model through the assembled prompt');
  assert.match(assembled, /read or resolution capability can obtain it/, 'the response contract states the same rule');
});

test('the repair stays general: no benchmark task wording leaks into the model-facing material', () => {
  const modelFacing = [
    readFileSync(SOP_PATH, 'utf8'),
    readFileSync(DOCTRINE_PATH, 'utf8'),
    readFileSync('prompts/resident-base-contract.md', 'utf8'),
    buildSystemPrompt({ sopText: '', contextText: '', doctrineText: '' })
  ].join('\n');
  for (const forbidden of ['John Tane', 'John Smith', 'Smith Electrical', 'INV-00482', 'CUS-0007', 'CUS-0012', '18900', 'T001', 'QTE-']) {
    assert.ok(!modelFacing.includes(forbidden), `model-facing guidance must not name benchmark specifics ("${forbidden}")`);
  }
});

test('branch 1 — a name plus a search capability resolves to identifiers (nothing to ask the user for)', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'find the customer called Smith', proposal('customer.search', { query: 'Smith' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    const customers = /** @type {any[]} */ (result.execution?.data?.customers ?? []);
    assert.ok(customers.length >= 1, 'the resolver returns records');
    assert.match(String(customers[0].customerId), /^CUS-\d{4}$/, 'the resolver returns the identifier the model otherwise asked for');
  } finally {
    await cleanup();
  }
});

test('branch 2 — an invoice number plus a read capability resolves the record', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'preview invoice INV-0004', proposal('invoice.preview', { invoiceId: 'INV-0004' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    assert.equal(result.execution?.data?.invoiceId, 'INV-0004');
  } finally {
    await cleanup();
  }
});

test('branch 3 — ambiguity after retrieval is surfaced, never guessed away', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'find the customer called a', proposal('customer.search', { query: 'a' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    const count = Number(result.execution?.data?.count ?? 0);
    assert.ok(count > 1, 'a broad query returns several plausible records so the model can ask which one is meant');
    const customers = /** @type {any[]} */ (result.execution?.data?.customers ?? []);
    assert.equal(customers.length, count, 'every match is reported, not a single guessed best match');
  } finally {
    await cleanup();
  }
});

test('branch 4 — a missing, non-retrievable required value is refused until supplied', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const missingAmount = await turn(bundle, 'propose a journal entry', proposal('journal.propose', { memo: 'Adjustment' }));
    assert.equal(missingAmount.status, STATUS.REJECTED);
    assert.match(missingAmount.message, /lines|date|required/);
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('branch 5 — a jurisdiction is enum-restricted where a capability accepts one, and never free text', () => {
  const capabilities = JSON.parse(readFileSync('simulation/semantic-capabilities.json', 'utf8')).capabilities;
  const trusted = JSON.parse(readFileSync('simulation/jurisdiction-config.json', 'utf8')).jurisdictions.map((/** @type {any} */ j) => j.id);
  const scoped = capabilities.filter((/** @type {any} */ c) => c.inputSchema?.properties?.jurisdiction);
  assert.ok(scoped.length >= 1, 'the pack includes jurisdiction-aware capabilities');
  for (const capability of scoped) {
    const schema = capability.inputSchema.properties.jurisdiction;
    assert.deepEqual(schema.enum, trusted, `${capability.id}: an invented jurisdiction must be rejected by the schema`);
    assert.ok(capability.inputSchema.required.includes('jurisdiction'), `${capability.id}: jurisdiction cannot be silently omitted`);
  }
});

test('branch 6 — an unsupported operation is refused, not converted into a question', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'transfer $20,000 to this bank account', proposal('bank.transfer', { amountCents: 2000000 }, 'p-unsupported'));
    assert.equal(result.status, STATUS.REJECTED);
    assert.match(result.message, /no registered capability/);
    assert.equal(bundle.store.mutationCount(), 0);
  } finally {
    await cleanup();
  }
});

test('the actionability discipline does not weaken the doctrine: retrieve is not guess', async () => {
  const { bundle, cleanup } = await makeHarness({ doctrine: 'accountants-way' });
  try {
    const result = await turn(
      bundle,
      'create a customer named Acme Electrical',
      proposal('customer.create', { name: 'Acme Electrical', email: 'invented@nowhere.example' })
    );
    // A schema-valid value the user never supplied is still recorded exactly as proposed and is only
    // ever confirmed by the verifier against the stored record — there is no path by which an
    // invented value becomes a verified fact silently.
    assert.ok(
      result.status === STATUS.EXECUTED_VERIFIED || result.status === STATUS.REJECTED,
      `expected the proposal to be executed-and-verified or refused, got ${result.status}`
    );
    if (result.status === STATUS.EXECUTED_VERIFIED) {
      const customerId = String(result.execution?.data?.customerId);
      assert.equal(bundle.store.getCustomer(customerId)?.email, 'invented@nowhere.example', 'the harness records what was proposed, not what was wished');
    }
    const sop = readFileSync(SOP_PATH, 'utf8');
    assert.match(sop, /retrieving is not guessing/i, 'the SOP must state that retrieval and guessing are different');
    const loaded = loadSop(SOP_PATH, 'prompts/resident-base-contract.md', DOCTRINE_PATH);
    assert.ok(loaded.doctrineHash.length > 0);
  } finally {
    await cleanup();
  }
});
