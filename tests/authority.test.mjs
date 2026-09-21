/**
 * Authority and confirmation tests at the unit level: the states and refusals that the
 * harness-level tests can only exercise indirectly.
 *
 * @module tests/authority
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthority } from '../src/policy/authority.mjs';
import { createConfirmations } from '../src/policy/confirmations.mjs';
import { createClock } from '../src/core/util.mjs';

const BASE = Date.parse('2026-06-01T00:00:00.000Z');

function binding(overrides = {}) {
  return {
    policyDecision: 'ALLOW',
    runId: 'run-1',
    actorId: 'operator-local',
    workspaceId: 'workspace-a',
    capability: 'invoice.issue',
    capabilityVersion: 3,
    capabilitySnapshotId: 'ctx-1',
    risk: 'FINANCIAL',
    proposalHash: 'ph-1',
    argumentHash: 'ah-1',
    ...overrides
  };
}

test('a permit is refused unless the policy decision was ALLOW', () => {
  const authority = createAuthority({ clock: createClock(BASE), ttlMs: 60_000 });
  assert.throws(() => authority.issue(binding({ policyDecision: 'DENY' })), /policy decision was DENY/);
  assert.throws(() => authority.issue(binding({ policyDecision: 'CONFIRMATION_REQUIRED' })), /policy decision was CONFIRMATION_REQUIRED/);
});

test('a permit is refused when any binding value is missing or malformed', () => {
  const authority = createAuthority({ clock: createClock(BASE), ttlMs: 60_000 });
  assert.throws(() => authority.issue(binding({ actorId: '' })), /without actorId/);
  assert.throws(() => authority.issue(binding({ workspaceId: '' })), /without workspaceId/);
  assert.throws(() => authority.issue(binding({ proposalHash: '' })), /without proposalHash/);
  assert.throws(() => authority.issue(binding({ capabilityVersion: 0 })), /without a capability version/);
  assert.throws(() => authority.issue(binding({ argumentHash: '' })), /without argumentHash/);
});

test('a permit is single-use, expiring, and bound to its snapshot identity', () => {
  const clock = createClock(BASE);
  const authority = createAuthority({ clock, ttlMs: 1000 });
  const permit = authority.issue(binding());
  assert.equal(permit.state, 'ACTIVE');
  assert.match(permit.nonce, /^[0-9a-f]{32}$/);

  assert.equal(authority.consume({ permitId: permit.permitId, ...binding() }).ok, true);
  const reuse = authority.consume({ permitId: permit.permitId, ...binding() });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, 'PERMIT_CONSUMED');

  const second = authority.issue(binding({ runId: 'run-2' }));
  clock.advance(1001);
  const expired = authority.consume({ permitId: second.permitId, ...binding({ runId: 'run-2' }) });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'PERMIT_EXPIRED');
  assert.equal(authority.get(second.permitId), undefined, 'an expired permit is swept on use');
});

test('a permit for one actor or workspace cannot be presented by another', () => {
  const authority = createAuthority({ clock: createClock(BASE), ttlMs: 1000 });
  const p1 = authority.issue(binding());
  assert.equal(authority.consume({ permitId: p1.permitId, ...binding({ actorId: 'other' }) }).code, 'ACTOR_MISMATCH');
  const p2 = authority.issue(binding());
  assert.equal(authority.consume({ permitId: p2.permitId, ...binding({ workspaceId: 'workspace-b' }) }).code, 'WORKSPACE_MISMATCH');
  const p3 = authority.issue(binding());
  assert.equal(authority.consume({ permitId: p3.permitId, ...binding({ capabilitySnapshotId: 'ctx-2' }) }).code, 'SNAPSHOT_MISMATCH');
  const p4 = authority.issue(binding());
  assert.equal(authority.consume({ permitId: p4.permitId, ...binding({ capabilityVersion: 4 }) }).code, 'CAPABILITY_VERSION_MISMATCH');
});

test('a confirmation is bound to a frozen proposal, one turn, one use and a TTL', () => {
  const clock = createClock(BASE);
  const confirmations = createConfirmations({ clock, ttlMs: 5000 });
  const proposal = { proposalId: 'p-1', capability: 'invoice.issue', arguments: { invoiceId: 'INV-0004' } };

  const armed = confirmations.arm({
    runId: 'run-1',
    turn: 1,
    proposal,
    proposalHash: 'ph-1',
    capability: 'invoice.issue',
    capabilityVersion: 1,
    capabilitySnapshotId: 'ctx-1',
    actorId: 'operator-local',
    workspaceId: 'workspace-a',
    risk: 'FINANCIAL'
  });

  assert.equal(confirmations.pendingCount(), 1);
  const granted = confirmations.resolve({ text: ' yes ', turn: 1 });
  assert.equal(granted.ok, true);
  assert.equal(granted.ok === true && granted.decision, 'GRANTED');
  assert.equal(confirmations.pendingCount(), 0);

  const replay = confirmations.resolve({ text: 'yes', turn: 1 });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'CONFIRMATION_NOT_FOUND');
});

test('the frozen proposal is the proposal that was approved (mutation is impossible)', () => {
  const confirmations = createConfirmations({ clock: createClock(BASE), ttlMs: 5000 });
  const proposal = { proposalId: 'p-2', capability: 'invoice.issue', arguments: { invoiceId: 'INV-0004' } };
  const { confirmation } = confirmations.arm({
    runId: 'run-1',
    turn: 1,
    proposal,
    proposalHash: 'ph-2',
    capability: 'invoice.issue',
    capabilityVersion: 1,
    capabilitySnapshotId: 'ctx-1',
    actorId: 'operator-local',
    workspaceId: 'workspace-a',
    risk: 'FINANCIAL'
  });
  /** @type {any} */ (proposal.arguments).invoiceId = 'INV-0003';
  assert.equal(/** @type {any} */ (confirmation.proposal.arguments).invoiceId, 'INV-0004');
  assert.equal(Object.isFrozen(/** @type {any} */ (confirmation.proposal.arguments)), true);
});

test('stale, ambiguous, expired and unrecognised answers are refused', () => {
  const clock = createClock(BASE);
  const confirmations = createConfirmations({ clock, ttlMs: 1000 });
  const arm = (/** @type {number} */ turn) =>
    confirmations.arm({
      runId: 'run-1',
      turn,
      proposal: { proposalId: `p-${turn}`, capability: 'invoice.issue', arguments: {} },
      proposalHash: `ph-${turn}`,
      capability: 'invoice.issue',
      capabilityVersion: 1,
      capabilitySnapshotId: 'ctx-1',
      actorId: 'operator-local',
      workspaceId: 'workspace-a',
      risk: 'FINANCIAL'
    });

  arm(1);
  const unrecognised = confirmations.resolve({ text: 'maybe later', turn: 1 });
  assert.equal(unrecognised.ok, false);
  assert.equal(unrecognised.code, 'CONFIRMATION_UNRECOGNISED');

  const declined = confirmations.resolve({ text: 'no', turn: 1 });
  assert.equal(declined.ok, true);
  assert.equal(declined.ok === true && declined.decision, 'DECLINED');

  arm(2);
  const stale = confirmations.resolve({ text: 'yes', turn: 3 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'CONFIRMATION_STALE');

  arm(4);
  clock.advance(1001);
  const expired = confirmations.resolve({ text: 'yes', turn: 4 });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'CONFIRMATION_EXPIRED');

  arm(5);
  const second = arm(5);
  assert.equal(second.superseded.length, 1, 'arming a new confirmation supersedes the old one');
  const onlyOne = confirmations.resolve({ text: 'yes', turn: 5 });
  assert.equal(onlyOne.ok, true);
  assert.ok(onlyOne.confirmation, 'a granted answer carries the confirmation');
  assert.equal(onlyOne.confirmation?.proposalHash, 'ph-5');
});

test('a new turn invalidates every pending confirmation from earlier turns', () => {
  const confirmations = createConfirmations({ clock: createClock(BASE), ttlMs: 10_000 });
  confirmations.arm({
    runId: 'run-1',
    turn: 1,
    proposal: { proposalId: 'p-1', capability: 'invoice.issue', arguments: {} },
    proposalHash: 'ph-1',
    capability: 'invoice.issue',
    capabilityVersion: 1,
    capabilitySnapshotId: 'ctx-1',
    actorId: 'operator-local',
    workspaceId: 'workspace-a',
    risk: 'FINANCIAL'
  });
  const invalidated = confirmations.invalidateForNewTurn(2);
  assert.equal(invalidated.length, 1);
  assert.equal(confirmations.pendingCount(), 0);
});
