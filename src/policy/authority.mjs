/**
 * Authority: the one-use permit.
 *
 * A permit is the only thing that lets an adapter run. It is bound to exactly one canonical
 * proposal hash, one capability AND its version, one capability snapshot, one actor, one
 * workspace, and one expiry, and it is consumed atomically immediately before execution
 * (docs/ARCHITECTURE.md I-1/I-2; research R-33 TOCTOU, R-34 single-use/expiring/audience-bound
 * authority, R-51 reference permit lifecycle).
 *
 * "Audience" here is concrete: actorId + workspaceId + capabilitySnapshotId. A permit issued
 * for one operator in one workspace can never be presented by another, and a permit issued
 * against one capability snapshot can never be reused after the context moved on.
 *
 * Consumption is synchronous and there is no `await` between checking and consuming, so two
 * concurrent requests cannot both win the same permit.
 *
 * @module policy/authority
 */

import { AuthorityError, CODES } from '../core/errors.mjs';
import { makeId, msToIso } from '../core/util.mjs';
import { randomBytes } from 'node:crypto';

/**
 * @typedef {object} Permit
 * @property {string} permitId
 * @property {string} nonce
 * @property {string} runId
 * @property {string} actorId
 * @property {string} workspaceId
 * @property {string} capability
 * @property {number} capabilityVersion
 * @property {string} capabilitySnapshotId
 * @property {string} risk
 * @property {string} proposalHash
 * @property {string} argumentHash
 * @property {string|null} confirmationId
 * @property {number} issuedAt
 * @property {number} expiresAt
 * @property {'ACTIVE'|'CONSUMED'} state
 */

export const PERMIT_STATE = Object.freeze({ ACTIVE: 'ACTIVE', CONSUMED: 'CONSUMED' });

/**
 * @param {{ clock: import('../core/util.mjs').Clock, ttlMs: number }} deps
 */
export function createAuthority(deps) {
  const { clock, ttlMs } = deps;
  /** @type {Map<string, Permit>} */
  const permits = new Map();

  return {
    /**
     * Issue a permit. Refuses unless the policy decision was ALLOW (R-51), and refuses if any
     * binding value is missing.
     * @param {{ policyDecision: string, runId: string, actorId: string, workspaceId: string, capability: string, capabilityVersion: number, capabilitySnapshotId: string, risk: string, proposalHash: string, argumentHash: string, confirmationId?: string|null }} input
     * @returns {Permit}
     */
    issue(input) {
      if (input.policyDecision !== 'ALLOW') {
        throw new AuthorityError(CODES.PERMIT_REFUSED, `refusing to issue a permit: policy decision was ${input.policyDecision}`);
      }
      for (const field of ['runId', 'actorId', 'workspaceId', 'capability', 'capabilitySnapshotId', 'risk', 'proposalHash', 'argumentHash']) {
        const value = /** @type {Record<string, unknown>} */ (input)[field];
        if (typeof value !== 'string' || value.length === 0) {
          throw new AuthorityError(CODES.PERMIT_REFUSED, `refusing to issue a permit without ${field}`);
        }
      }
      if (!Number.isInteger(input.capabilityVersion) || input.capabilityVersion < 1) {
        throw new AuthorityError(CODES.PERMIT_REFUSED, 'refusing to issue a permit without a capability version');
      }
      const now = clock.now();
      /** @type {Permit} */
      const permit = {
        permitId: makeId('permit'),
        nonce: randomBytes(16).toString('hex'),
        runId: input.runId,
        actorId: input.actorId,
        workspaceId: input.workspaceId,
        capability: input.capability,
        capabilityVersion: input.capabilityVersion,
        capabilitySnapshotId: input.capabilitySnapshotId,
        risk: input.risk,
        proposalHash: input.proposalHash,
        argumentHash: input.argumentHash,
        confirmationId: input.confirmationId ?? null,
        issuedAt: now,
        expiresAt: now + ttlMs,
        state: PERMIT_STATE.ACTIVE
      };
      permits.set(permit.permitId, permit);
      return { ...permit };
    },

    /**
     * Consume a permit. Every refusal is typed and leaves the permit untouched unless it was
     * expired (an expired permit is swept).
     * @param {{ permitId: string, runId: string, actorId: string, workspaceId: string, capability: string, capabilityVersion: number, capabilitySnapshotId: string, proposalHash: string, argumentHash: string }} input
     * @returns {{ ok: boolean, permit?: Permit, code?: string, detail?: string }}
     */
    consume(input) {
      const permit = permits.get(input.permitId);
      if (!permit) return refusal(CODES.PERMIT_NOT_FOUND, 'no such permit in this session');
      if (permit.state === PERMIT_STATE.CONSUMED) return refusal(CODES.PERMIT_CONSUMED, 'permit has already been used');
      if (clock.now() > permit.expiresAt) {
        permits.delete(permit.permitId);
        return refusal(CODES.PERMIT_EXPIRED, `permit expired at ${msToIso(permit.expiresAt)}`);
      }
      if (permit.runId !== input.runId) return refusal(CODES.RUN_MISMATCH, 'permit belongs to a different run');
      if (permit.actorId !== input.actorId) return refusal(CODES.ACTOR_MISMATCH, `permit was issued for actor ${permit.actorId}`);
      if (permit.workspaceId !== input.workspaceId) {
        return refusal(CODES.WORKSPACE_MISMATCH, `permit was issued for workspace ${permit.workspaceId}`);
      }
      if (permit.capability !== input.capability) {
        return refusal(CODES.CAPABILITY_MISMATCH, `permit was issued for ${permit.capability}`);
      }
      if (permit.capabilityVersion !== input.capabilityVersion) {
        return refusal(
          CODES.CAPABILITY_VERSION_MISMATCH,
          `permit was issued for version ${permit.capabilityVersion}, execution requested version ${input.capabilityVersion}`
        );
      }
      if (permit.capabilitySnapshotId !== input.capabilitySnapshotId) {
        return refusal(CODES.SNAPSHOT_MISMATCH, 'permit was issued against a different capability snapshot');
      }
      if (permit.proposalHash !== input.proposalHash) {
        return refusal(CODES.PROPOSAL_MISMATCH, 'permit was issued for different arguments');
      }
      if (permit.argumentHash !== input.argumentHash) {
        return refusal(CODES.PROPOSAL_MISMATCH, 'permit argument hash does not match the arguments presented');
      }
      permit.state = PERMIT_STATE.CONSUMED;
      return { ok: true, permit: { ...permit } };
    },

    /** @param {string} permitId */
    get(permitId) {
      const permit = permits.get(permitId);
      return permit ? { ...permit } : undefined;
    },

    /** Drop expired permits. Called opportunistically; permits are per-session and few. */
    sweep() {
      const now = clock.now();
      let removed = 0;
      for (const [id, permit] of permits) {
        if (now > permit.expiresAt) {
          permits.delete(id);
          removed += 1;
        }
      }
      return removed;
    },

    activeCount() {
      return permits.size;
    }
  };

  /**
   * @param {string} code
   * @param {string} detail
   * @returns {{ ok: false, code: string, detail: string }}
   */
  function refusal(code, detail) {
    return { ok: false, code, detail };
  }
}
