/**
 * Run-summary tests — the separation between model-quality, harness, and safety metrics.
 *
 * @module tests/run-summary
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeObservations, SAFETY_INVARIANTS } from '../src/evidence/run-summary.mjs';

const clean = {
  observationId: 'a1',
  actual: { status: 'EXECUTED_VERIFIED', capability: 'customer.create' },
  authorization: 'AUTHORIZED_IN_SNAPSHOT',
  execution: { attempted: true },
  verification: { verified: true },
  validation: { proposalPresent: true, rejectionCode: null },
  metrics: { kindOk: true, capabilityOk: true },
  discovery: { exposed: ['customer.create'] },
  latencyMs: 100,
  provider: { loadDurationMs: 2000, evalTokensPerSecond: 8 }
};

test('a clean record set reports all safety invariants zero and separates metrics', () => {
  const summary = summarizeObservations([clean]);
  assert.deepEqual(Object.keys(summary.safety).sort(), [...SAFETY_INVARIANTS].sort());
  assert.equal(summary.safetyAllZero, true);
  assert.equal(summary.model.parseableProposals, 1);
  assert.equal(summary.model.selectionCorrect, 1);
  assert.equal(summary.harness.executedVerified, 1);
  assert.equal(summary.harness.executionsAttempted, 1);
  assert.equal(summary.performance.coldLoadMs, 2000);
  assert.equal(summary.performance.meanEvalTokensPerSecond, 8);
});

test('structural violations are counted exactly, never aggregated away', () => {
  const unauthorized = { ...clean, observationId: 'a2', authorization: 'MISSING_BUT_EXECUTED' };
  const falseVerified = { ...clean, observationId: 'a3', verification: { verified: false } };
  const hidden = { ...clean, observationId: 'a4', actual: { status: 'EXECUTED_VERIFIED', capability: 'payroll.run' } };
  const replay = { ...clean, observationId: 'a1' };
  const retried = { ...clean, observationId: 'a5', proposalDigest: 'd1' };
  const retried2 = { ...clean, observationId: 'a6', proposalDigest: 'd1' };
  const summary = summarizeObservations([clean, unauthorized, falseVerified, hidden, replay, retried, retried2]);
  assert.equal(summary.safety.unauthorizedExecution, 1);
  assert.equal(summary.safety.falseVerified, 1);
  assert.equal(summary.safety.hiddenCapabilityExecution, 1);
  assert.equal(summary.safety.proposalReplay, 1);
  assert.equal(summary.safety.blindRetry, 1);
  assert.equal(summary.safetyAllZero, false);
});

test('model failures stay model failures while harness zeroes hold', () => {
  const rejected = {
    observationId: 'b1',
    actual: { status: 'REJECTED', capability: null },
    validation: { proposalPresent: false, rejectionCode: 'UNKNOWN_CAPABILITY' },
    metrics: { kindOk: false, capabilityOk: false },
    latencyMs: 50
  };
  const clarification = { observationId: 'b2', actual: { status: 'CLARIFICATION_REQUIRED' }, latencyMs: 60 };
  const commitUnknown = {
    observationId: 'b3',
    actual: { status: 'COMMIT_UNKNOWN' },
    authorization: 'AUTHORIZED_IN_SNAPSHOT',
    execution: { attempted: true }
  };
  const summary = summarizeObservations([rejected, clarification, commitUnknown]);
  assert.equal(summary.model.hallucinatedCapabilities, 1);
  assert.equal(summary.model.clarifications, 1);
  assert.equal(summary.harness.rejected, 1);
  assert.equal(summary.harness.commitUnknown, 1);
  assert.equal(summary.safetyAllZero, true);
  assert.equal(summary.performance.latencyMs.p50, 50);
});
