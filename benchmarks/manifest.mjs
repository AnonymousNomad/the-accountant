/**
 * Manifest construction and hashing (Phase 2 / S19-defect repairs).
 *
 * Two properties are load-bearing and both are tested in `tests/manifest.test.mjs`:
 *
 *  1. The hash must be STABLE across restarts, or resume is impossible. Volatile bookkeeping
 *     (`frozenAt`) is therefore excluded from the hashed body — an earlier runner included it and
 *     produced a different hash on every process start, which made every resume refuse (the guard
 *     worked; the input was wrong).
 *  2. The hash must cover the configuration that ACTUALLY executes — the loaded config file's own
 *     sha256 and the fingerprint of the effective configuration object — not merely the path the
 *     operator typed.
 *
 * @module benchmarks/manifest
 */

import { canonicalJson, sha256Hex } from '../src/core/canonical.mjs';

/**
 * @typedef {object} ManifestInput
 * @property {string} experiment
 * @property {{ id: string, repetition: number }[]} tasks
 * @property {number} repetitions
 * @property {Record<string, unknown>} envelope
 * @property {{ configPath: string, configFileSha256: string, effectiveConfigHash: string }} configTruth
 */

/**
 * @param {ManifestInput} input
 * @param {string} [frozenAt]
 * @returns {Record<string, unknown>}
 */
export function buildManifest(input, frozenAt = new Date().toISOString()) {
  return {
    experiment: input.experiment,
    tasks: input.tasks,
    repetitions: input.repetitions,
    configTruth: input.configTruth,
    envelope: input.envelope,
    frozenAt
  };
}

/**
 * Hash the manifest body, excluding volatile fields. Callers must use this function (never a bare
 * hash of the object) so that stability is guaranteed by construction.
 * @param {Record<string, unknown>} manifest
 * @returns {string}
 */
export function manifestHashOf(manifest) {
  const { frozenAt, ...stable } = manifest;
  void frozenAt;
  return sha256Hex(canonicalJson(stable));
}
