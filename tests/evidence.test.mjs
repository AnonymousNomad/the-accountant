/**
 * Evidence tests: append-only behaviour, the hash chain and its tamper evidence, redaction,
 * and the privacy-minimal shape of a recorded tool result.
 *
 * @module tests/evidence
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJournal, redact } from '../src/evidence/journal.mjs';
import { createClock } from '../src/core/util.mjs';
import { makeHarness, turn, proposal } from './helpers/fixtures.mjs';
import { STATUS } from '../src/harness.mjs';

const BASE = Date.parse('2026-07-01T00:00:00.000Z');

test('the journal is append-only, sequence-numbered and verifiable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sah-journal-1-'));
  const journal = createJournal({ dir, sessionId: 'sess-test-1', clock: createClock(BASE) });
  await journal.init();
  await journal.append('PROPOSED', { data: { a: 1 } });
  await journal.append('VERIFIED', { data: { b: 2 } });
  const report = await journal.verifyChain();
  assert.equal(report.valid, true);
  assert.equal(report.entries, 2);
  const events = await journal.read(10);
  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
  assert.equal(events[1].prevHash, events[0].hash);
});

test('tampering with any record breaks the chain at that sequence number', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sah-journal-2-'));
  const journal = createJournal({ dir, sessionId: 'sess-test-2', clock: createClock(BASE) });
  await journal.init();
  await journal.append('PROPOSED', { data: { amount: 100 } });
  await journal.append('VERIFIED', { data: { ok: true } });
  const file = journal.filePath;
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  const first = JSON.parse(lines[0]);
  first.data.amount = 999999;
  lines[0] = JSON.stringify(first);
  await writeFile(file, `${lines.join('\n')}\n`, 'utf8');
  const report = await journal.verifyChain();
  assert.equal(report.valid, false);
  assert.equal(report.firstBadSeq, 1);
  assert.match(String(report.reason), /hash mismatch/);
});

test('credential-bearing keys and credential-shaped values are redacted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sah-journal-3-'));
  const journal = createJournal({ dir, sessionId: 'sess-test-3', clock: createClock(BASE) });
  await journal.init();
  const event = await journal.append('PROPOSED', {
    data: {
      password: 'hunter2',
      authorization: 'Bearer abcdefghijklmnop',
      nested: { access_token: 'xyz', note: 'ok' },
      message: 'sent with Authorization: Bearer abcdefghijklmnop'
    }
  });
  const data = /** @type {any} */ (event.data);
  assert.equal(data.password, '[REDACTED]');
  assert.equal(data.authorization, '[REDACTED]');
  assert.equal(data.nested.access_token, '[REDACTED]');
  assert.equal(data.nested.note, 'ok');
  assert.match(String(event.data.message), /\[REDACTED\]/);
  assert.doesNotMatch(String(data.message), /abcdefghijklmnop/);
});

test('innocent keys that merely contain the word token are not redacted', () => {
  assert.equal(/** @type {any} */ (redact({ approxTokens: 1781 })).approxTokens, 1781);
  assert.equal(/** @type {any} */ (redact({ tokenCount: 12 })).tokenCount, 12);
  assert.equal(/** @type {any} */ (redact({ webhook_secret: 'x' })).webhook_secret, '[REDACTED]');
  assert.equal(/** @type {any} */ (redact({ accessToken: 'x' })).accessToken, '[REDACTED]');
});

test('a verified run records identifiers and a digest, never the whole payload', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const result = await turn(bundle, 'create a customer named Acme Electrical', proposal('customer.create', { name: 'Acme Electrical' }));
    assert.equal(result.status, STATUS.EXECUTED_VERIFIED);
    const events = await bundle.journal.read(50);
    const succeeded = events.find((event) => event.type === 'EXECUTION_SUCCEEDED' && event.runId === result.runId);
    assert.ok(succeeded, 'the run must record EXECUTION_SUCCEEDED');
    const toolResult = /** @type {any} */ (succeeded.data.toolResult);
    assert.equal(toolResult.capabilityId, 'customer.create');
    assert.equal(toolResult.ids.customerId, 'CUS-0004');
    assert.equal(typeof toolResult.digest, 'string');
    assert.match(String(toolResult.summary), /customer.create succeeded/);
    assert.equal('email' in toolResult.ids, false, 'payload fields beyond identifiers are not copied into evidence');
    assert.equal('data' in succeeded.data, false, 'the raw adapter payload is not written to the journal');
  } finally {
    await cleanup();
  }
});

test('the journal reconstructs what was requested, approved, executed and verified', async () => {
  const { bundle, cleanup } = await makeHarness();
  try {
    const proposed = await turn(bundle, 'issue invoice INV-0004', proposal('invoice.issue', { invoiceId: 'INV-0004' }, 'p-recon'));
    const granted = await bundle.harness.confirm('yes');
    assert.equal(granted.status, STATUS.EXECUTED_VERIFIED);

    const all = await bundle.journal.read(200);
    const proposalEvents = all.filter((event) => event.runId === proposed.runId);
    assert.ok(proposalEvents.some((event) => event.type === 'PROPOSED'), 'the proposal turn records PROPOSED');
    const proposedEvent = proposalEvents.find((event) => event.type === 'PROPOSED');
    assert.deepEqual(proposedEvent?.data.arguments, { invoiceId: 'INV-0004' });

    const executionEvents = all.filter((event) => event.runId === granted.runId);
    const types = executionEvents.map((event) => event.type);
    for (const required of ['CONFIRMATION_GRANTED', 'AUTHORIZED', 'AUTHORITY_CONSUMED', 'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED', 'VERIFIED']) {
      assert.ok(types.includes(required), `the execution turn must include ${required}`);
    }

    // The execution turn links back to the turn that proposed the action, and both agree on the
    // proposal hash and the frozen arguments.
    const confirmed = executionEvents.find((event) => event.type === 'CONFIRMATION_GRANTED');
    assert.equal(confirmed?.data.originRunId, proposed.runId);
    const authorized = executionEvents.find((event) => event.type === 'AUTHORIZED');
    assert.equal(authorized?.data.originRunId, proposed.runId);
    assert.ok(authorized?.data.capabilitySnapshotId, 'authority is bound to a capability snapshot');
    assert.ok(authorized?.data.argumentHash, 'authority is bound to the argument hash');
    assert.equal(authorized?.proposalHash, proposedEvent?.proposalHash, 'authority is bound to the approved proposal hash');
    assert.equal(executionEvents.filter((event) => event.type === 'AUTHORITY_CONSUMED').length, 1, 'exactly one consumption');
    assert.equal(executionEvents.filter((event) => event.type === 'EXECUTION_STARTED').length, 1, 'exactly one execution');
  } finally {
    await cleanup();
  }
});

test('a journal cannot be initialised into a directory it cannot create, and that is reported', async () => {
  const dir = join(process.cwd(), 'var', 'evidence-test-4');
  await mkdir(dir, { recursive: true });
  const journal = createJournal({ dir: join(dir, 'file-as-directory', 'nested'), sessionId: 'sess-test-4', clock: createClock(BASE) });
  await writeFile(join(dir, 'file-as-directory'), 'not a directory', 'utf8');
  await assert.rejects(() => journal.init(), /EEXIST|ENOTDIR|EPERM/);
});
