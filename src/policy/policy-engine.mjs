/**
 * The policy engine: the deterministic decision that stands between a validated proposal and
 * any execution authority.
 *
 * It consults only trusted state — registry metadata, the capability-context snapshot from
 * this turn, configured permissions, configured risk classes, and adapter availability. The
 * model has no input here, and there is no code path in which an internal error becomes
 * permission: like the reference implementation's fail-closed wrapper (research R-52), an
 * exception resolves to DENY (research R-29 complete mediation, R-26 authorization
 * downstream).
 *
 * @module policy/policy-engine
 */

import { PolicyError, CODES, messageOf } from '../core/errors.mjs';
import { riskRequiresConfirmation, RISK } from './risk.mjs';

export const DECISION = Object.freeze({
  ALLOW: 'ALLOW',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  DENY: 'DENY'
});

export const POLICY_REASONS = Object.freeze({
  UNKNOWN_CAPABILITY: 'UNKNOWN_CAPABILITY',
  CAPABILITY_DISABLED: 'CAPABILITY_DISABLED',
  CAPABILITY_NOT_EXPOSED: 'CAPABILITY_NOT_EXPOSED',
  CAPABILITY_VERSION_MISMATCH: 'CAPABILITY_VERSION_MISMATCH',
  CAPABILITY_CONTEXT_STALE: 'CAPABILITY_CONTEXT_STALE',
  PERMISSION_NOT_GRANTED: 'PERMISSION_NOT_GRANTED',
  RISK_NOT_AUTHORIZED: 'RISK_NOT_AUTHORIZED',
  ADAPTER_DISABLED: 'ADAPTER_DISABLED',
  ADAPTER_NOT_REGISTERED: 'ADAPTER_NOT_REGISTERED',
  ADAPTER_BINDING_MISSING: 'ADAPTER_BINDING_MISSING',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  POLICY_ERROR: 'POLICY_ERROR',
  ALLOWED: 'ALLOWED'
});

/**
 * @typedef {object} PolicyDecision
 * @property {'ALLOW'|'CONFIRMATION_REQUIRED'|'DENY'} decision
 * @property {string} reason
 * @property {string} [detail]
 * @property {string} [requirement]
 */

/**
 * @param {{ config: { policy: { riskAllowlist: string[], requireConfirmationFor: string[], grantedPermissions: string[] } }, registry: import('../registry/registry.mjs').Registry, adapters: { mock: { enabled: boolean, has: (operation: string) => boolean }, http: { enabled: boolean, resolveBinding: (id: string) => unknown } } }} deps
 * @returns {{ evaluate: (input: { capabilityId: string, context: import('../registry/context.mjs').CapabilityContext }) => PolicyDecision }}
 */
export function createPolicyEngine(deps) {
  const { config, registry, adapters } = deps;

  return {
    /**
     * @param {{ capabilityId: string, context: import('../registry/context.mjs').CapabilityContext }} input
     * @returns {PolicyDecision}
     */
    evaluate(input) {
      try {
        return evaluateStrict(input);
      } catch (err) {
        return {
          decision: DECISION.DENY,
          reason: POLICY_REASONS.POLICY_ERROR,
          detail: messageOf(err)
        };
      }
    }
  };

  /**
   * @param {{ capabilityId: string, context: import('../registry/context.mjs').CapabilityContext }} input
   * @returns {PolicyDecision}
   */
  function evaluateStrict(input) {
    const { capabilityId, context } = input;
    if (typeof capabilityId !== 'string' || capabilityId.length === 0) {
      return { decision: DECISION.DENY, reason: POLICY_REASONS.UNKNOWN_CAPABILITY, detail: 'empty capability id' };
    }

    const capability = registry.get(capabilityId);
    if (!capability) {
      return { decision: DECISION.DENY, reason: POLICY_REASONS.UNKNOWN_CAPABILITY, detail: capabilityId };
    }

    // Revocation: a capability disabled after the snapshot was built cannot execute.
    if (!capability.enabled) {
      return {
        decision: DECISION.DENY,
        reason: POLICY_REASONS.CAPABILITY_DISABLED,
        detail: `capability "${capabilityId}" is disabled`
      };
    }

    if (!context.ids.includes(capabilityId)) {
      return {
        decision: DECISION.DENY,
        reason: POLICY_REASONS.CAPABILITY_NOT_EXPOSED,
        detail: `capability was not in the context presented for this turn (${context.ids.join(', ') || 'none'})`
      };
    }

    // Version substitution: the snapshot records the version the model was shown.
    const snapshotEntry = context.capabilities.find((entry) => entry.id === capabilityId);
    if (!snapshotEntry || snapshotEntry.version !== capability.version) {
      return {
        decision: DECISION.DENY,
        reason: POLICY_REASONS.CAPABILITY_VERSION_MISMATCH,
        detail: `snapshot has version ${String(snapshotEntry?.version)} but the registry holds ${capability.version}`
      };
    }

    if (context.registryHash !== registry.hash()) {
      return {
        decision: DECISION.DENY,
        reason: POLICY_REASONS.CAPABILITY_CONTEXT_STALE,
        detail: 'the registry changed after this capability context was built'
      };
    }

    const missing = capability.requiredPermissions.filter((p) => !config.policy.grantedPermissions.includes(p));
    if (missing.length > 0) {
      return { decision: DECISION.DENY, reason: POLICY_REASONS.PERMISSION_NOT_GRANTED, detail: missing.join(', ') };
    }

    if (!config.policy.riskAllowlist.includes(capability.risk)) {
      return { decision: DECISION.DENY, reason: POLICY_REASONS.RISK_NOT_AUTHORIZED, detail: capability.risk };
    }

    if (capability.adapter.kind === 'mock') {
      if (!adapters.mock.enabled) {
        return { decision: DECISION.DENY, reason: POLICY_REASONS.ADAPTER_DISABLED, detail: 'mock adapter is disabled' };
      }
      if (!adapters.mock.has(String(capability.adapter.operation))) {
        return {
          decision: DECISION.DENY,
          reason: POLICY_REASONS.ADAPTER_NOT_REGISTERED,
          detail: `no adapter operation "${String(capability.adapter.operation)}" is registered`
        };
      }
    } else if (capability.adapter.kind === 'http') {
      if (!adapters.http.enabled) {
        return { decision: DECISION.DENY, reason: POLICY_REASONS.ADAPTER_DISABLED, detail: 'http adapter is disabled' };
      }
      const binding = adapters.http.resolveBinding(capability.id);
      if (!binding) {
        return {
          decision: DECISION.DENY,
          reason: POLICY_REASONS.ADAPTER_BINDING_MISSING,
          detail: `no trusted binding is configured for ${capability.id}`
        };
      }
    } else {
      return { decision: DECISION.DENY, reason: POLICY_REASONS.ADAPTER_DISABLED, detail: `unknown adapter kind ${String(capability.adapter.kind)}` };
    }

    const confirmationRequired =
      capability.requiresConfirmation || riskRequiresConfirmation(config.policy, capability.risk);
    if (confirmationRequired) {
      return {
        decision: DECISION.CONFIRMATION_REQUIRED,
        reason: POLICY_REASONS.CONFIRMATION_REQUIRED,
        requirement:
          capability.risk === RISK.FINANCIAL
            ? 'FINANCIAL operations always require explicit confirmation'
            : 'this capability is configured to require confirmation'
      };
    }

    return { decision: DECISION.ALLOW, reason: POLICY_REASONS.ALLOWED };
  }
}

export { PolicyError, CODES };
