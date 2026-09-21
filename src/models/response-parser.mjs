/**
 * Deterministic response parsing.
 *
 * The model's text is untrusted input (research R-27). This module extracts EXACTLY ONE JSON
 * object and validates the envelope; it never repairs, never extracts a "close enough"
 * substring, and never falls back to a regex over prose (research R-24; decision DM-07).
 * A malformed response is a rejection, which is a safe, recorded outcome.
 *
 * @module models/response-parser
 */

import { ProposalError, CODES } from '../core/errors.mjs';
import { validate } from '../core/schema.mjs';
import { ENVELOPE_SCHEMA } from './prompt.mjs';

export const PROPOSAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * @typedef {{ kind: 'proposal', proposalId: string, capability: string, arguments: Record<string, unknown>, reasoningSummary: string }
 *   | { kind: 'clarification', question: string, reasoningSummary: string }
 *   | { kind: 'unsupported', reason: string, reasoningSummary: string }} Envelope
 */

/**
 * Parse and validate a model response into an envelope.
 * @param {string} text
 * @returns {Envelope}
 */
export function parseEnvelope(text) {
  const json = extractSingleJsonObject(text);
  const issues = validate(json, /** @type {Record<string, unknown>} */ (ENVELOPE_SCHEMA));
  if (issues.length > 0) {
    throw new ProposalError(
      CODES.RESPONSE_ENVELOPE_INVALID,
      `response envelope invalid: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      { reason: issues.map((i) => `${i.path} ${i.message}`).join('; ') }
    );
  }
  const record = /** @type {Record<string, unknown>} */ (json);
  const kind = record.kind;

  if (kind === 'proposal') {
    const allowed = ['kind', 'proposalId', 'capability', 'arguments', 'reasoningSummary'];
    rejectExtraFields(record, allowed);
    const proposalId = record.proposalId;
    if (typeof proposalId !== 'string' || !PROPOSAL_ID_PATTERN.test(proposalId)) {
      throw new ProposalError(CODES.RESPONSE_ENVELOPE_INVALID, 'proposal.proposalId must match [A-Za-z0-9._:-]{1,64}', {
        reason: 'proposalId shape'
      });
    }
    const capability = record.capability;
    if (typeof capability !== 'string' || capability.length < 3) {
      throw new ProposalError(CODES.RESPONSE_ENVELOPE_INVALID, 'proposal.capability must be a capability id', {
        reason: 'capability shape'
      });
    }
    const args = record.arguments;
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw new ProposalError(CODES.RESPONSE_ENVELOPE_INVALID, 'proposal.arguments must be an object', { reason: 'arguments shape' });
    }
    return {
      kind: 'proposal',
      proposalId,
      capability,
      arguments: /** @type {Record<string, unknown>} */ (args),
      reasoningSummary: String(record.reasoningSummary)
    };
  }

  if (kind === 'clarification') {
    rejectExtraFields(record, ['kind', 'question', 'reasoningSummary']);
    const question = record.question;
    if (typeof question !== 'string' || question.trim().length === 0) {
      throw new ProposalError(CODES.RESPONSE_ENVELOPE_INVALID, 'clarification.question must be a non-empty string', {
        reason: 'question shape'
      });
    }
    return { kind: 'clarification', question: question.trim(), reasoningSummary: String(record.reasoningSummary) };
  }

  rejectExtraFields(record, ['kind', 'reason', 'reasoningSummary']);
  const reason = record.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new ProposalError(CODES.RESPONSE_ENVELOPE_INVALID, 'unsupported.reason must be a non-empty string', {
      reason: 'reason shape'
    });
  }
  return { kind: 'unsupported', reason: reason.trim(), reasoningSummary: String(record.reasoningSummary) };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} allowed
 */
function rejectExtraFields(record, allowed) {
  const extra = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new ProposalError(CODES.RESPONSE_ENVELOPE_INVALID, `response ${record.kind} must not contain: ${extra.join(', ')}`, {
      reason: `unexpected fields: ${extra.join(', ')}`
    });
  }
}

/**
 * Extract a single JSON object from raw model text.
 *
 * Accepted forms: the trimmed text is one JSON object, or the trimmed text is exactly one
 * fenced code block (```json … ``` / ``` … ```) containing one JSON object. Anything else —
 * prose before/after, two objects, an array, a truncated object — is rejected.
 * @param {string} raw
 * @returns {unknown}
 */
export function extractSingleJsonObject(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model returned an empty response');
  }
  let text = raw.trim();

  const fence = matchSingleFence(text);
  if (fence !== null) text = fence.trim();

  if (!text.startsWith('{')) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model response is not a JSON object', {
      reason: `starts with "${text.slice(0, 40)}"`
    });
  }

  const end = findObjectEnd(text);
  if (end === -1) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model response contains an unterminated JSON object', {
      reason: 'truncated or unbalanced braces'
    });
  }
  const tail = text.slice(end + 1).trim();
  if (tail.length > 0) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model response contains content after the JSON object', {
      reason: `trailing content: "${tail.slice(0, 40)}"`
    });
  }

  try {
    return JSON.parse(text.slice(0, end + 1));
  } catch (err) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, `model response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, {
      reason: 'json parse error'
    });
  }
}

/**
 * @param {string} text
 * @returns {string|null} the fenced body, or null when there is no fence
 */
function matchSingleFence(text) {
  if (!text.startsWith('```')) return null;
  const firstNewline = text.indexOf('\n');
  if (firstNewline === -1) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model response has a malformed code fence');
  }
  const close = text.indexOf('```', firstNewline);
  if (close === -1) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model response has an unterminated code fence');
  }
  const after = text.slice(close + 3).trim();
  if (after.length > 0) {
    throw new ProposalError(CODES.RESPONSE_NOT_JSON, 'model response has content after the code fence', {
      reason: `trailing content: "${after.slice(0, 40)}"`
    });
  }
  return text.slice(firstNewline + 1, close);
}

/**
 * Find the index of the closing brace of the object that starts at index 0.
 * String-aware and escape-aware so that braces inside strings do not confuse it.
 * @param {string} text
 * @returns {number} -1 when unbalanced
 */
function findObjectEnd(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
