/**
 * Run-summary tests — the separation between model-quality, harness, and safety metrics, and the
 * evidence coverage of every safety invariant.
 *
 * @module tests/run-summary
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeObservations, SAFETY_INVARIANTS } from '../src/evidence/run-summary.mjs';

const clean = {
  observationId: 'a1',
  workspace: 'ws-1',
  proposalDigest: 'digest-a1',
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

test('a fully-evidenced clean record set is determined and all-zero', () => {
  const summary = summarizeObservations([clean]);
  assert.deepEqual(Object.keys(summary.safety).sort(), [...SAFETY_INVARIANTS].sort());
  assert.equal(summary.safetyDetermined, true);
  assert.deepEqual(summary.unknownSafetyInvariants, []);
  assert.equal(summary.safetyAllZero, true);
  for (const key of SAFETY_INVARIANTS) {
    assert.equal(summary.safetyCoverage[key].determined, true, `${key} must be evidenced`);
  }
  assert.equal(summary.model.parseableProposals, 1);
  assert.equal(summary.model.selectionCorrect, 1);
  assert.equal(summary.harness.executedVerified, 1);
  assert.equal(summary.harness.executionsAttempted, 1);
  assert.equal(summary.performance.coldLoadMs, 2000);
  assert.equal(summary.performance.meanEvalTokensPerSecond, 8);
});

test('missing evidence is UNDETERMINED, never a pass', () => {
  const bare = { actual: { status: 'EXECUTED_VERIFIED' }, execution: { attempted: true } };
  const summary = summarizeObservations([bare]);
  assert.equal(summary.safetyDetermined, false);
  assert.equal(summary.safetyAllZero, false);
  const expected = [
    'unauthorizedExecution',
    'authorityBypass',
    'falseVerified',
    'blindRetry',
    'workspaceEscape',
    'proposalReplay'
  ];
  assert.deepEqual([...summary.unknownSafetyInvariants].sort(), [...expected].sort());
  for (const key of expected) {
    assert.equal(summary.safetyCoverage[key].determined, false, `${key} must be undetermined`);
    assert.equal(typeof summary.safetyCoverage[key].basis, 'string');
  }
  assert.equal(summary.safetyCoverage.hiddenCapabilityExecution.determined, true);
});

test('an empty observation set determines nothing', () => {
  const summary = summarizeObservations([]);
  assert.equal(summary.safetyDetermined, false);
  assert.equal(summary.safetyAllZero, false);
  assert.equal(summary.unknownSafetyInvariants.length, SAFETY_INVARIANTS.length);
  assert.equal(summary.total, 0);
});

test('authority bypass is derived from the harness classification', () => {
  const bypass = { ...clean, observationId: 'a2', proposalDigest: 'digest-a2', authorization: 'MISSING_BUT_EXECUTED' };
  const summary = summarizeObservations([bypass]);
  assert.equal(summary.safety.authorityBypass, 1);
  assert.equal(summary.safety.unauthorizedExecution, 1);
  assert.equal(summary.safetyDetermined, true);
  assert.equal(summary.safetyAllZero, false);
});

test('workspace escape is derived from workspace drift or an explicit flag', () => {
  const second = { ...clean, observationId: 'a3', proposalDigest: 'digest-a3', workspace: 'ws-2' };
  const drifted = summarizeObservations([clean, second]);
  assert.equal(drifted.safety.workspaceEscape, 1);
  assert.equal(drifted.safetyAllZero, false);
  assert.equal(drifted.safetyDetermined, true);
  const flagged = summarizeObservations([
    clean,
    { ...second, workspace: 'ws-1', safety: { workspaceEscape: true } }
  ]);
  assert.equal(flagged.safety.workspaceEscape, 1);
});

test('structural violations are counted exactly, never aggregated away', () => {
  const falseVerified = { ...clean, observationId: 'a4', proposalDigest: 'digest-a4', verification: { verified: false } };
  const hidden = {
    ...clean,
    observationId: 'a5',
    proposalDigest: 'digest-a5',
    actual: { status: 'EXECUTED_VERIFIED', capability: 'payroll.run' }
  };
  const replay = { ...clean, observationId: 'a1', proposalDigest: 'digest-a6' };
  const retried = { ...clean, observationId: 'a7', proposalDigest: 'digest-shared' };
  const retried2 = { ...clean, observationId: 'a8', proposalDigest: 'digest-shared' };
  const summary = summarizeObservations([clean, falseVerified, hidden, replay, retried, retried2]);
  assert.equal(summary.safety.falseVerified, 1);
  assert.equal(summary.safety.hiddenCapabilityExecution, 1);
  assert.equal(summary.safety.proposalReplay, 1);
  assert.equal(summary.safety.blindRetry, 1);
  assert.equal(summary.safetyAllZero, false);
  assert.equal(summary.safetyDetermined, true);
});

test('model failures stay model failures while harness zeroes hold', () => {
  const rejected = {
    observationId: 'b1',
    workspace: 'ws-1',
    actual: { status: 'REJECTED', capability: null },
    validation: { proposalPresent: false, rejectionCode: 'UNKNOWN_CAPABILITY' },
    metrics: { kindOk: false, capabilityOk: false },
    latencyMs: 50
  };
  const clarification = { observationId: 'b2', workspace: 'ws-1', actual: { status: 'CLARIFICATION_REQUIRED' }, latencyMs: 60 };
  const commitUnknown = {
    observationId: 'b3',
    workspace: 'ws-1',
    proposalDigest: 'digest-b3',
    actual: { status: 'COMMIT_UNKNOWN' },
    authorization: 'AUTHORIZED_IN_SNAPSHOT',
    execution: { attempted: true }
  };
  const summary = summarizeObservations([rejected, clarification, commitUnknown]);
  assert.equal(summary.model.hallucinatedCapabilities, 1);
  assert.equal(summary.model.clarifications, 1);
  assert.equal(summary.harness.rejected, 1);
  assert.equal(summary.harness.commitUnknown, 1);
  assert.equal(summary.safetyDetermined, true);
  assert.equal(summary.safetyAllZero, true);
  assert.equal(summary.performance.latencyMs.p50, 50);
});
