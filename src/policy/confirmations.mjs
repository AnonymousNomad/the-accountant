/**
 * Confirmation: binding human approval to one frozen proposal, one turn, and one expiry.
 *
 * This module exists because "the user said yes" is not evidence of approval for anything in
 * particular. Three rules make approval meaningful (docs/ARCHITECTURE.md I-3, decision
 * DM-13, threats T-05/T-08):
 *
 *  1. the approved object is a deep-frozen snapshot, so the arguments that execute are the
 *     arguments that were displayed;
 *  2. approval is only resolvable during the turn that armed it, so a "yes" hours (or even
 *     one instruction) later cannot authorise a forgotten action;
 *  3. approval is single-use and expires, so it cannot be replayed.
 *
 * Only one confirmation can be pending at a time. Arming a new one supersedes the old one
 * loudly rather than creating an ambiguity about which proposal a "yes" refers to.
 *
 * @module policy/confirmations
 */

import { ConfirmationError, CODES } from '../core/errors.mjs';
import { deepFreeze, makeId, msToIso } from '../core/util.mjs';

const AFFIRMATIVE = new Set(['yes', 'y', 'confirm', 'confirmed', 'approve', 'approved', 'ok', 'okay']);
const NEGATIVE = new Set(['no', 'n', 'reject', 'rejected', 'cancel', 'cancelled', 'canceled', 'deny', 'denied', 'stop']);

/**
 * @typedef {object} Confirmation
 * @property {string} confirmationId
 * @property {string} runId
 * @property {number} armedTurn
 * @property {string} proposalHash
 * @property {string} capability
 * @property {number} capabilityVersion
 * @property {string} capabilitySnapshotId
 * @property {string} actorId
 * @property {string} workspaceId
 * @property {string} risk
 * @property {Record<string, unknown>} proposal   Frozen snapshot of what was approved.
 * @property {number} armedAt
 * @property {number} expiresAt
 * @property {'PENDING'|'CONSUMED'} state
 */

/**
 * @param {{ clock: import('../core/util.mjs').Clock, ttlMs: number }} deps
 */
export function createConfirmations(deps) {
  const { clock, ttlMs } = deps;
  /** @type {Map<string, Confirmation>} */
  const pending = new Map();

  return {
    /**
     * Arm a confirmation for a validated proposal. Supersedes any previous pending one.
     * @param {{ runId: string, turn: number, proposal: Record<string, unknown>, proposalHash: string, capability: string, capabilityVersion: number, capabilitySnapshotId: string, actorId: string, workspaceId: string, risk: string }} input
     * @returns {{ confirmation: Confirmation, superseded: string[] }}
     */
    arm(input) {
      /** @type {string[]} */
      const superseded = [];
      for (const [id, existing] of pending) {
        if (existing.state === 'PENDING') {
          pending.delete(id);
          superseded.push(id);
        }
      }
      const now = clock.now();
      /** @type {Confirmation} */
      const confirmation = {
        confirmationId: makeId('conf'),
        runId: input.runId,
        armedTurn: input.turn,
        proposalHash: input.proposalHash,
        capability: input.capability,
        capabilityVersion: input.capabilityVersion,
        capabilitySnapshotId: input.capabilitySnapshotId,
        actorId: input.actorId,
        workspaceId: input.workspaceId,
        risk: input.risk,
        proposal: deepFreeze(structuredClone(input.proposal)),
        armedAt: now,
        expiresAt: now + ttlMs,
        state: 'PENDING'
      };
      pending.set(confirmation.confirmationId, confirmation);
      return { confirmation, superseded };
    },

    /**
     * Resolve an operator answer against the single live pending confirmation.
     * @param {{ text: string, turn: number }} input
     * @returns {{ ok: boolean, decision?: 'GRANTED'|'DECLINED', confirmation?: Confirmation, code?: string, detail?: string }}
     */
    resolve(input) {
      const answer = input.text.trim().toLowerCase();
      const live = [...pending.values()].filter((c) => c.state === 'PENDING');
      if (live.length === 0) {
        return refusal(CODES.CONFIRMATION_NOT_FOUND, 'there is no pending confirmation');
      }
      if (live.length > 1) {
        // Defensive: the store should never hold two live confirmations.
        return refusal(CODES.CONFIRMATION_NOT_FOUND, 'ambiguous state: more than one confirmation is pending');
      }
      const confirmation = /** @type {Confirmation} */ (live[0]);

      if (confirmation.armedTurn !== input.turn) {
        pending.delete(confirmation.confirmationId);
        return refusal(
          CODES.CONFIRMATION_STALE,
          `this confirmation was armed during turn ${confirmation.armedTurn}; the session has moved on (turn ${input.turn})`
        );
      }
      if (clock.now() > confirmation.expiresAt) {
        pending.delete(confirmation.confirmationId);
        return refusal(CODES.CONFIRMATION_EXPIRED, `confirmation expired at ${msToIso(confirmation.expiresAt)}`);
      }

      const isAffirmative = AFFIRMATIVE.has(answer);
      const isNegative = NEGATIVE.has(answer);
      if (!isAffirmative && !isNegative) {
        return refusal(
          CODES.CONFIRMATION_UNRECOGNISED,
          `"${input.text.trim()}" is not a confirmation answer; reply yes or no`
        );
      }

      confirmation.state = 'CONSUMED';
      if (isNegative) {
        return { ok: true, decision: 'DECLINED', confirmation: frozenView(confirmation) };
      }
      return { ok: true, decision: 'GRANTED', confirmation: frozenView(confirmation) };
    },

    /** @param {string} confirmationId */
    get(confirmationId) {
      const confirmation = pending.get(confirmationId);
      return confirmation ? frozenView(confirmation) : undefined;
    },

    pendingCount() {
      return [...pending.values()].filter((c) => c.state === 'PENDING').length;
    },

    /** Called when a new instruction arrives: nothing from an earlier turn stays approvable. */
    invalidateForNewTurn(/** @type {number} */ turn) {
      /** @type {string[]} */
      const invalidated = [];
      for (const [id, confirmation] of pending) {
        if (confirmation.state === 'PENDING' && confirmation.armedTurn !== turn) {
          pending.delete(id);
          invalidated.push(id);
        }
      }
      return invalidated;
    }
  };

  /**
   * @param {Confirmation} confirmation
   * @returns {Confirmation}
   */
  function frozenView(confirmation) {
    return { ...confirmation, proposal: confirmation.proposal };
  }

  /**
   * @param {string} code
   * @param {string} detail
   * @returns {{ ok: false, code: string, detail: string }}
   */
  function refusal(code, detail) {
    return { ok: false, code, detail };
  }
}

export { ConfirmationError, CODES };
