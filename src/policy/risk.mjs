/**
 * Risk classes.
 *
 * Risk is a property of the OPERATION, fixed in trusted capability metadata by a human
 * (sops/capability_risk_classification.md). It is never read from, restated by, or lowered
 * on behalf of the model (docs/ARCHITECTURE.md I-4; research R-26).
 *
 * @module policy/risk
 */

import { CapabilityError, CODES } from '../core/errors.mjs';

export const RISK = Object.freeze({
  /** Reads state. No mutation. Normally executable when permitted. */
  READ: 'READ',
  /** Creates bounded, non-posted state (a draft). No external financial effect. */
  DRAFT: 'DRAFT',
  /** Mutates existing state. Policy-controlled. */
  MUTATION: 'MUTATION',
  /** Moves value or changes posted financial state. Always requires confirmation. */
  FINANCIAL: 'FINANCIAL'
});

/** Ascending impact order, for reporting and future policy comparisons. */
export const RISK_ORDER = Object.freeze([RISK.READ, RISK.DRAFT, RISK.MUTATION, RISK.FINANCIAL]);

/**
 * @param {unknown} value
 * @returns {string} the risk class
 */
export function assertRiskClass(value) {
  if (typeof value !== 'string' || !/** @type {string[]} */ (RISK_ORDER).includes(value)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `risk must be one of ${RISK_ORDER.join(', ')}; got ${String(value)}`);
  }
  return value;
}

/**
 * Risk classes that must never be executable without an explicit human confirmation.
 * FINANCIAL is unconditional; the config may add more.
 * @param {{ requireConfirmationFor: string[] }} policy
 * @param {string} risk
 * @returns {boolean}
 */
export function riskRequiresConfirmation(policy, risk) {
  return risk === RISK.FINANCIAL || policy.requireConfirmationFor.includes(risk);
}
