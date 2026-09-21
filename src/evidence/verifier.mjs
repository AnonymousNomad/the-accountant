/**
 * Verification: turning "the adapter said it worked" into an independently checked fact.
 *
 * Verification is deliberately separate from execution (docs/ARCHITECTURE.md §3.5). A
 * capability's verifier reads authoritative domain state and checks specific claims
 * (research R-41: state-based checks, not response-based self-report). A missing verifier is a
 * registration error, a throwing verifier is a FAILED verification, and no code path here can
 * produce a pass for an unregistered check (research R-52's fail-closed spirit).
 *
 * @module evidence/verifier
 */

import { VerificationError, CODES, messageOf } from '../core/errors.mjs';

/**
 * @typedef {object} VerificationCheck
 * @property {string} check
 * @property {boolean} ok
 * @property {string} [detail]
 */

/**
 * @typedef {object} VerificationOutcome
 * @property {boolean} passed
 * @property {VerificationCheck[]} checks
 */

/**
 * @typedef {(input: { capability: import('../registry/capability.mjs').Capability, proposal: Record<string, unknown>, arguments: Record<string, unknown>, execution: { ok: boolean, data?: Record<string, unknown>, code?: string } }) => { checks: VerificationCheck[] }} VerifierFn
 */

/**
 * @returns {{ register: (id: string, fn: VerifierFn) => void, has: (id: string) => boolean, ids: () => string[], run: (input: { verifierId: string, capability: import('../registry/capability.mjs').Capability, proposal: Record<string, unknown>, arguments: Record<string, unknown>, execution: { ok: boolean, data?: Record<string, unknown>, code?: string } }) => VerificationOutcome }}
 */
export function createVerifierRegistry() {
  /** @type {Map<string, VerifierFn>} */
  const verifiers = new Map();

  return {
    /**
     * @param {string} id
     * @param {VerifierFn} fn
     */
    register(id, fn) {
      if (typeof id !== 'string' || id.length < 2) {
        throw new VerificationError(CODES.VERIFIER_NOT_REGISTERED, 'verifier id must be a string of at least 2 characters');
      }
      if (typeof fn !== 'function') {
        throw new VerificationError(CODES.VERIFIER_NOT_REGISTERED, `verifier "${id}" must be a function`);
      }
      if (verifiers.has(id)) {
        throw new VerificationError(CODES.VERIFIER_NOT_REGISTERED, `verifier "${id}" is already registered`);
      }
      verifiers.set(id, fn);
    },

    /** @param {string} id */
    has(id) {
      return verifiers.has(id);
    },

    ids() {
      return [...verifiers.keys()].sort();
    },

    /**
     * @param {{ verifierId: string, capability: import('../registry/capability.mjs').Capability, proposal: Record<string, unknown>, arguments: Record<string, unknown>, execution: { ok: boolean, data?: Record<string, unknown>, code?: string } }} input
     * @returns {VerificationOutcome}
     */
    run(input) {
      const verifier = verifiers.get(input.verifierId);
      if (!verifier) {
        return {
          passed: false,
          checks: [
            {
              check: 'verifier_registered',
              ok: false,
              detail: `no verifier registered for "${input.verifierId}"; unverified executions are never reported as success`
            }
          ]
        };
      }
      /** @type {VerificationCheck[]} */
      let checks;
      try {
        checks = verifier({
          capability: input.capability,
          proposal: input.proposal,
          arguments: input.arguments,
          execution: input.execution
        }).checks;
      } catch (err) {
        return {
          passed: false,
          checks: [{ check: 'verifier_execution', ok: false, detail: `verifier threw: ${messageOf(err)}` }]
        };
      }
      if (!Array.isArray(checks) || checks.length === 0) {
        return {
          passed: false,
          checks: [{ check: 'verifier_registered', ok: false, detail: 'verifier produced no checks; an empty verification is not a pass' }]
        };
      }
      const passed = checks.every((check) => check.ok === true);
      return { passed, checks };
    }
  };
}

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 * @returns {VerificationCheck}
 */
export function check(name, ok, detail) {
  return detail === undefined ? { check: name, ok } : { check: name, ok, detail };
}
