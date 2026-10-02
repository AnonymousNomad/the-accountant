/**
 * Typed error taxonomy for the harness.
 *
 * Every failure carries a stable machine-readable `code` so that callers, the CLI, tests,
 * and the evidence journal can distinguish causes without parsing prose. Errors are the ONLY
 * failure mechanism; nothing in this codebase returns a success-shaped value on failure.
 *
 * @module core/errors
 */

/** Stable failure codes. Never rename an existing code; add new ones. */
export const CODES = Object.freeze({
  CONFIG_INVALID: 'CONFIG_INVALID',
  SCHEMA_UNSUPPORTED: 'SCHEMA_UNSUPPORTED',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  CAPABILITY_INVALID: 'CAPABILITY_INVALID',
  CAPABILITY_DUPLICATE: 'CAPABILITY_DUPLICATE',
  CAPABILITY_CONTEXT_STALE: 'CAPABILITY_CONTEXT_STALE',
  PROPOSAL_INVALID: 'PROPOSAL_INVALID',
  PROPOSAL_ID_REPLAY: 'PROPOSAL_ID_REPLAY',
  RESPONSE_NOT_JSON: 'RESPONSE_NOT_JSON',
  RESPONSE_ENVELOPE_INVALID: 'RESPONSE_ENVELOPE_INVALID',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_MODEL_MISSING: 'PROVIDER_MODEL_MISSING',
  PROVIDER_HTTP_ERROR: 'PROVIDER_HTTP_ERROR',
  PROVIDER_BAD_RESPONSE: 'PROVIDER_BAD_RESPONSE',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  SCRIPT_EXHAUSTED: 'SCRIPT_EXHAUSTED',
  POLICY_DENIED: 'POLICY_DENIED',
  POLICY_ERROR: 'POLICY_ERROR',
  PERMIT_REFUSED: 'PERMIT_REFUSED',
  PERMIT_NOT_FOUND: 'PERMIT_NOT_FOUND',
  PERMIT_EXPIRED: 'PERMIT_EXPIRED',
  PERMIT_CONSUMED: 'PERMIT_CONSUMED',
  PROPOSAL_MISMATCH: 'PROPOSAL_MISMATCH',
  CAPABILITY_MISMATCH: 'CAPABILITY_MISMATCH',
  CAPABILITY_VERSION_MISMATCH: 'CAPABILITY_VERSION_MISMATCH',
  SNAPSHOT_MISMATCH: 'SNAPSHOT_MISMATCH',
  ACTOR_MISMATCH: 'ACTOR_MISMATCH',
  WORKSPACE_MISMATCH: 'WORKSPACE_MISMATCH',
  RUN_MISMATCH: 'RUN_MISMATCH',
  COMMIT_UNKNOWN: 'COMMIT_UNKNOWN',
  CONFIRMATION_NOT_FOUND: 'CONFIRMATION_NOT_FOUND',
  CONFIRMATION_STALE: 'CONFIRMATION_STALE',
  CONFIRMATION_EXPIRED: 'CONFIRMATION_EXPIRED',
  CONFIRMATION_CONSUMED: 'CONFIRMATION_CONSUMED',
  CONFIRMATION_SUPERSEDED: 'CONFIRMATION_SUPERSEDED',
  CONFIRMATION_DECLINED: 'CONFIRMATION_DECLINED',
  CONFIRMATION_UNRECOGNISED: 'CONFIRMATION_UNRECOGNISED',
  CONFIRMATION_NOT_REQUIRED: 'CONFIRMATION_NOT_REQUIRED',
  ADAPTER_DISABLED: 'ADAPTER_DISABLED',
  ADAPTER_NOT_REGISTERED: 'ADAPTER_NOT_REGISTERED',
  ADAPTER_BINDING_MISSING: 'ADAPTER_BINDING_MISSING',
  ADAPTER_ERROR: 'ADAPTER_ERROR',
  ADAPTER_TIMEOUT: 'ADAPTER_TIMEOUT',
  ADAPTER_HTTP_STATUS: 'ADAPTER_HTTP_STATUS',
  ADAPTER_BAD_RESPONSE: 'ADAPTER_BAD_RESPONSE',
  ADAPTER_UNEXPECTED_RESPONSE: 'ADAPTER_UNEXPECTED_RESPONSE',
  ADAPTER_INPUT_INVALID: 'ADAPTER_INPUT_INVALID',
  DOMAIN_OPERATION_FAILED: 'DOMAIN_OPERATION_FAILED',
  VERIFIER_NOT_REGISTERED: 'VERIFIER_NOT_REGISTERED',
  VERIFIER_ERROR: 'VERIFIER_ERROR',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  PREREQUISITE_NOT_REGISTERED: 'PREREQUISITE_NOT_REGISTERED',
  EVIDENCE_WRITE_FAILED: 'EVIDENCE_WRITE_FAILED',
  EVIDENCE_CHAIN_BROKEN: 'EVIDENCE_CHAIN_BROKEN'
});

/**
 * @typedef {object} ErrorDetail
 * @property {string} [stage]   Pipeline stage that failed.
 * @property {string} [reason]  Human-readable reason.
 * @property {number} [toolCalls] Observed native tool-call count when the single-action contract is violated.
 * @property {unknown} [value]  Additional structured detail (never secrets).
 */

export class HarnessError extends Error {
  /**
   * @param {string} code    One of CODES.
   * @param {string} message Operator-facing message.
   * @param {ErrorDetail} [detail] Structured detail.
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.detail = detail;
  }
}

export class ConfigError extends HarnessError {}
export class SchemaError extends HarnessError {}
export class CapabilityError extends HarnessError {}
export class ProposalError extends HarnessError {}
export class ProviderError extends HarnessError {}
export class PolicyError extends HarnessError {}
export class AuthorityError extends HarnessError {}
export class ConfirmationError extends HarnessError {}
export class AdapterError extends HarnessError {}
export class DomainError extends HarnessError {}
export class VerificationError extends HarnessError {}
export class EvidenceError extends HarnessError {}

/**
 * Extract a safe message from an unknown thrown value.
 * @param {unknown} err
 * @returns {string}
 */
export function messageOf(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unprintable error';
  }
}

/**
 * Extract the stable code from an unknown thrown value.
 * @param {unknown} err
 * @returns {string}
 */
export function codeOf(err) {
  if (err instanceof HarnessError) return err.code;
  return 'UNEXPECTED_ERROR';
}
