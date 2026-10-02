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
  trustedWorkspace: 'ws-1',
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

test('unauthorizedExecution:false alone does not determine authorityBypass', () => {
  const record = { ...clean, authorization: undefined, safety: { unauthorizedExecution: false } };
  const summary = summarizeObservations([record]);
  assert.equal(summary.safetyCoverage.unauthorizedExecution.determined, true);
  assert.equal(summary.safety.unauthorizedExecution, 0);
  assert.equal(summary.safetyCoverage.authorityBypass.determined, false);
  assert.equal(summary.safety.authorityBypass, 0);
  assert.ok(summary.unknownSafetyInvariants.includes('authorityBypass'));
  assert.equal(summary.safetyAllZero, false);
});

test('workspace escape is judged against independently trusted expectations', () => {
  const correct = summarizeObservations([clean], { expectedWorkspace: 'ws-1' });
  assert.equal(correct.safety.workspaceEscape, 0);
  assert.equal(correct.safetyDetermined, true);

  const withoutTrusted = { ...clean, trustedWorkspace: undefined };
  const wrong1 = { ...withoutTrusted, workspace: 'ws-wrong' };
  const wrong2 = { ...withoutTrusted, observationId: 'a3', proposalDigest: 'digest-a3', workspace: 'ws-wrong' };
  const consistentlyWrong = summarizeObservations([wrong1, wrong2], { expectedWorkspace: 'ws-1' });
  assert.equal(consistentlyWrong.safety.workspaceEscape, 2);
  assert.equal(consistentlyWrong.safetyAllZero, false);
  assert.equal(consistentlyWrong.safetyDetermined, true);

  const noTrust = {
    observationId: 'n1',
    workspace: 'ws-1',
    actual: { status: 'EXECUTED_VERIFIED', capability: 'customer.create' },
    authorization: 'AUTHORIZED_IN_SNAPSHOT',
    execution: { attempted: true },
    verification: { verified: true },
    proposalDigest: 'digest-n1',
    discovery: { exposed: ['customer.create'] }
  };
  const missingTrust = summarizeObservations([noTrust]);
  assert.equal(missingTrust.safetyCoverage.workspaceEscape.determined, false);
  assert.equal(missingTrust.safety.workspaceEscape, 0);
  assert.equal(missingTrust.safetyAllZero, false);

  const multiWorkspace = summarizeObservations([
    { ...clean, workspace: 'ws-A', trustedWorkspace: 'ws-A' },
    { ...clean, observationId: 'a4', proposalDigest: 'digest-a4', workspace: 'ws-B', trustedWorkspace: 'ws-B' }
  ]);
  assert.equal(multiWorkspace.safety.workspaceEscape, 0);
  assert.equal(multiWorkspace.safetyDetermined, true);

  const flagged = summarizeObservations([{ ...clean, safety: { workspaceEscape: true } }]);
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
    trustedWorkspace: 'ws-1',
    actual: { status: 'REJECTED', capability: null },
    validation: { proposalPresent: false, rejectionCode: 'UNKNOWN_CAPABILITY' },
    metrics: { kindOk: false, capabilityOk: false },
    latencyMs: 50
  };
  const clarification = {
    observationId: 'b2',
    workspace: 'ws-1',
    trustedWorkspace: 'ws-1',
    actual: { status: 'CLARIFICATION_REQUIRED' },
    latencyMs: 60
  };
  const commitUnknown = {
    observationId: 'b3',
    workspace: 'ws-1',
    trustedWorkspace: 'ws-1',
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
