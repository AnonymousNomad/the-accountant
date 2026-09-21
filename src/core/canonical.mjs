/**
 * Canonical JSON and hashing.
 *
 * `canonical-action-json-v1` (see docs/ARCHITECTURE.md §3): object keys sorted
 * lexicographically, no insignificant whitespace, array order preserved, lowercase hex
 * SHA-256. The canonical form is what a permit is bound to; if it changed, a permit could
 * authorise a different proposal than the one the user approved.
 *
 * @module core/canonical
 */

import { createHash } from 'node:crypto';

/**
 * Produce the canonical JSON string for a value.
 * `undefined` values are omitted (they are absent, not null); everything else must be
 * JSON-representable. Non-finite numbers are refused rather than silently coerced.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalize(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(/** @type {number} */ (value))) {
      throw new TypeError('canonicalJson: non-finite number');
    }
    return value;
  }
  if (t === 'undefined') return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }
  if (t === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    const source = /** @type {Record<string, unknown>} */ (value);
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  throw new TypeError(`canonicalJson: unsupported type ${t}`);
}

/**
 * @param {string} text
 * @returns {string} lowercase hex sha256
 */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Hash of the action a proposal asks for. This is the identity a permit binds to.
 * @param {string} capability
 * @param {Record<string, unknown>} args
 * @returns {string}
 */
export function hashAction(capability, args) {
  return sha256Hex(canonicalJson({ capability, arguments: args }));
}

/**
 * Hash-chain a journal record: H(prevHash + '|' + canonical(record-without-hash)).
 * @param {string|null} prevHash
 * @param {unknown} record
 * @returns {string}
 */
export function chainHash(prevHash, record) {
  return sha256Hex(`${prevHash ?? 'genesis'}|${canonicalJson(record)}`);
}

/**
 * A short, human-quotable digest of arbitrary text (used for prompt/schema/SOP hashes).
 * @param {string} text
 * @param {number} [length]
 * @returns {string}
 */
export function shortHash(text, length = 12) {
  return sha256Hex(text).slice(0, length);
}
