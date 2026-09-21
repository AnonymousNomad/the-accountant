/**
 * Small shared utilities: clock, identifier generation, freezing.
 *
 * The clock is injectable so that expiry, TTL, and staleness behaviour is testable without
 * sleeping, and so that benchmark runs can be reasoned about deterministically.
 *
 * @module core/util
 */

import { randomUUID } from 'node:crypto';

/**
 * @typedef {object} Clock
 * @property {() => number} now      Epoch milliseconds.
 * @property {() => string} nowIso   ISO-8601 string for evidence records.
 */

/** Real wall clock. */
export const systemClock = Object.freeze({
  now: () => Date.now(),
  nowIso: () => new Date().toISOString()
});

/**
 * A controllable clock for tests. Starts at `startMs` and only moves when advanced.
 * @param {number} [startMs]
 * @returns {Clock & { advance: (ms: number) => void }}
 */
export function createClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    nowIso: () => new Date(current).toISOString(),
    advance: (ms) => {
      current += ms;
    }
  };
}

/**
 * @param {string} prefix
 * @returns {string}
 */
export function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Recursively freeze an object graph. Used for approved proposals: the object executed after
 * confirmation must be the object approved, and freezing makes accidental mutation a loud
 * error instead of a silent divergence (see docs/ARCHITECTURE.md I-3).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(/** @type {Record<string, unknown>} */ (value)[key]);
  }
  return value;
}

/**
 * Deterministic, bounded keyword extraction for capability relevance.
 * Lowercased, alphanumeric tokens of length >= 3, deduplicated, insertion-ordered.
 * @param {string} text
 * @param {number} [limit]
 * @returns {string[]}
 */
export function extractKeywords(text, limit = 24) {
  const seen = new Set();
  const out = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Approximate token cost of a text block. Deliberately labelled approximate: it is a
 * character heuristic, not a tokenizer (docs/BENCHMARK.md records it as an estimate).
 * @param {string} text
 * @returns {number}
 */
export function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function msToIso(ms) {
  return new Date(ms).toISOString();
}
