/**
 * Evidence journal: append-only, hash-chained, redacted, local.
 *
 * Why this shape (research R-36 AU-2/AU-9/AU-11, R-53):
 *  - append-only + sequence numbers: history is never rewritten by this process;
 *  - `prevHash`/`hash` chain: any modification of an earlier record is detectable at that
 *    sequence number by `verifyChain()`;
 *  - redaction on every string, before hashing: a credential that reaches the journal is a
 *    credential leaked, so the journal never receives one;
 *  - outside model reach: the model is never given the journal path or its contents.
 *
 * A write failure raises EVIDENCE_WRITE_FAILED, and the harness treats that as fatal for the
 * action (docs/matrices/FAILURE_MATRIX.md F-26): an unauditable execution is not permitted.
 *
 * @module evidence/journal
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EvidenceError, CODES, messageOf } from '../core/errors.mjs';
import { chainHash } from '../core/canonical.mjs';

/** Event types. The bold ones in docs/ARCHITECTURE.md §3.4 are the required lifecycle. */
export const EVENT = Object.freeze({
  USER_INSTRUCTION: 'USER_INSTRUCTION',
  CAPABILITIES_EXPOSED: 'CAPABILITIES_EXPOSED',
  PROPOSED: 'PROPOSED',
  PROPOSAL_REJECTED: 'PROPOSAL_REJECTED',
  CLARIFICATION_REQUESTED: 'CLARIFICATION_REQUESTED',
  UNSUPPORTED_REQUEST: 'UNSUPPORTED_REQUEST',
  POLICY_DECISION: 'POLICY_DECISION',
  DENIED: 'DENIED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CONFIRMATION_GRANTED: 'CONFIRMATION_GRANTED',
  CONFIRMATION_REJECTED: 'CONFIRMATION_REJECTED',
  AUTHORIZED: 'AUTHORIZED',
  AUTHORITY_CONSUMED: 'AUTHORITY_CONSUMED',
  EXECUTION_STARTED: 'EXECUTION_STARTED',
  EXECUTION_SUCCEEDED: 'EXECUTION_SUCCEEDED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  COMMIT_UNKNOWN: 'COMMIT_UNKNOWN',
  VERIFIED: 'VERIFIED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  SESSION_CLOSED: 'SESSION_CLOSED'
});

/**
 * Credential-bearing key names are redacted wholesale. Matching is exact-name or
 * separator-suffixed on purpose: a substring rule would redact innocent keys such as
 * `approxTokens`, which silently corrupts legitimate evidence.
 */
const REDACT_KEY_EXACT = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'authorization',
  'credential',
  'credentials',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'bearer',
  'cookie',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'sessionkey',
  'session_key'
]);
const REDACT_KEY_SUFFIX = /[_.](token|secret|password|passwd|apikey|credential|key)s?$/i;

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return REDACT_KEY_EXACT.has(lower) || REDACT_KEY_SUFFIX.test(lower);
}

/** Value patterns that indicate a credential inside an otherwise innocent string (R-53). */
const REDACT_VALUE_PATTERNS = Object.freeze([
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi, replacement: '[API_KEY_REDACTED]' },
  { regex: /AKIA[0-9A-Z]{16}/g, replacement: '[AWS_KEY_REDACTED]' },
  { regex: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g, replacement: '[JWT_REDACTED]' },
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[PRIVATE_KEY_REDACTED]' },
  { regex: /gh[pousr]_[A-Za-z0-9]{30,}/g, replacement: '[GH_TOKEN_REDACTED]' },
  { regex: /:\/\/([^:@/]+):([^@/]+)@/g, replacement: '://[USER]:[PASS]@' }
]);

/**
 * @typedef {object} JournalEvent
 * @property {number} seq
 * @property {string} at
 * @property {string} type
 * @property {string} sessionId
 * @property {string|null} runId
 * @property {string|null} proposalId
 * @property {string|null} proposalHash
 * @property {string|null} capability
 * @property {string|null} risk
 * @property {string|null} permitId
 * @property {Record<string, unknown>} data
 * @property {string|null} prevHash
 * @property {string} hash
 */

/**
 * @param {{ dir: string, sessionId: string, clock: import('../core/util.mjs').Clock, includeContextText?: boolean }} deps
 */
export function createJournal(deps) {
  const { dir, sessionId, clock } = deps;
  const filePath = join(dir, `evidence-${sessionId}.jsonl`);
  let seq = 0;
  /** @type {string|null} */
  let prevHash = null;
  let initialized = false;

  return {
    filePath,

    /** Load the tail of an existing journal so a restarted session keeps one chain. */
    async init() {
      await mkdir(dir, { recursive: true });
      try {
        const raw = await readFile(filePath, 'utf8');
        const lines = raw.split('\n').filter((line) => line.trim().length > 0);
        if (lines.length > 0) {
          const last = JSON.parse(/** @type {string} */ (lines[lines.length - 1]));
          seq = typeof last.seq === 'number' ? last.seq : lines.length;
          prevHash = typeof last.hash === 'string' ? last.hash : null;
        }
      } catch {
        // A missing journal is the normal first run; anything else surfaces on first append.
      }
      initialized = true;
    },

    /**
     * Append one event. Returns the frozen record; throws on any write failure.
     * @param {string} type
     * @param {Record<string, unknown>} [fields]
     * @returns {Promise<JournalEvent>}
     */
    async append(type, fields = {}) {
      if (!initialized) await this.init();
      if (!/** @type {string[]} */ (Object.values(EVENT)).includes(type)) {
        throw new EvidenceError(CODES.EVIDENCE_WRITE_FAILED, `refusing to write unknown event type "${type}"`);
      }
      const base = {
        seq: seq + 1,
        at: clock.nowIso(),
        type,
        sessionId,
        runId: stringOrNull(fields.runId),
        proposalId: stringOrNull(fields.proposalId),
        proposalHash: stringOrNull(fields.proposalHash),
        capability: stringOrNull(fields.capability),
        risk: stringOrNull(fields.risk),
        permitId: stringOrNull(fields.permitId),
        data: /** @type {Record<string, unknown>} */ (redact(fields.data ?? {}))
      };
      const record = { ...base, prevHash, hash: chainHash(prevHash, base) };
      try {
        await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
      } catch (err) {
        throw new EvidenceError(CODES.EVIDENCE_WRITE_FAILED, `cannot append evidence to ${filePath}: ${messageOf(err)}`, {
          reason: 'journal write failed'
        });
      }
      seq = base.seq;
      prevHash = record.hash;
      return record;
    },

    /**
     * @param {number} [limit]
     * @returns {Promise<JournalEvent[]>}
     */
    async read(limit = 50) {
      try {
        const raw = await readFile(filePath, 'utf8');
        const lines = raw.split('\n').filter((line) => line.trim().length > 0);
        const slice = limit > 0 ? lines.slice(-limit) : lines;
        return slice.map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },

    /**
     * Replay the chain and report the first broken record. A modified journal must be
     * detectable at the sequence number where it was modified.
     * @returns {Promise<{ valid: boolean, entries: number, firstBadSeq?: number, reason?: string }>}
     */
    async verifyChain() {
      /** @type {string} */
      let raw;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch {
        return { valid: true, entries: 0 };
      }
      const lines = raw.split('\n').filter((line) => line.trim().length > 0);
      let expectedPrev = null;
      for (let i = 0; i < lines.length; i += 1) {
        /** @type {any} */
        let record;
        try {
          record = JSON.parse(/** @type {string} */ (lines[i]));
        } catch {
          return { valid: false, entries: lines.length, firstBadSeq: i + 1, reason: 'unparseable record' };
        }
        const { prevHash: recordPrev, hash: recordHash, ...rest } = record;
        const recomputed = chainHash(recordPrev ?? null, rest);
        if ((recordPrev ?? null) !== expectedPrev) {
          return { valid: false, entries: lines.length, firstBadSeq: record.seq, reason: 'previous-hash mismatch' };
        }
        if (recomputed !== recordHash) {
          return { valid: false, entries: lines.length, firstBadSeq: record.seq, reason: 'record hash mismatch' };
        }
        expectedPrev = recordHash;
      }
      return { valid: true, entries: lines.length };
    },

    lastSeq() {
      return seq;
    }
  };
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Redact a value graph: known credential-bearing key names are replaced wholesale, and
 * credential-shaped substrings inside ordinary strings are masked.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redact(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
      out[key] = isSensitiveKey(key) ? '[REDACTED]' : redact(entry);
    }
    return out;
  }
  return value;
}

/**
 * @param {string} text
 * @returns {string}
 */
function redactString(text) {
  let out = text;
  for (const { regex, replacement } of REDACT_VALUE_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out;
}
