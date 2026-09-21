/**
 * Capability Context Pack — the capability-awareness subsystem (addendum §2, §3, §8, §10).
 *
 * The model is never asked to remember tools and is never given the whole registry. For each
 * turn the harness builds a bounded, deterministic context containing only the operations
 * that are plausible for the current task, with enough guidance that a small local model can
 * choose correctly without guessing:
 *
 *   WHAT is available · WHAT it does · WHEN to use it · WHEN NOT to · what arguments are
 *   required · what permission/confirmation rules apply · what result to expect
 *
 * Every exclusion is recorded with a reason, so a bad outcome can be attributed to either
 * "the model chose badly" or "the harness gave the model bad choices" (addendum §8). The
 * snapshot returned here is the SAME trusted identity used later to validate the model's
 * selection: a capability that was not in this snapshot can never execute (addendum §9).
 *
 * @module registry/context
 */

import { sha256Hex, canonicalJson } from '../core/canonical.mjs';
import { extractKeywords, approxTokens, makeId } from '../core/util.mjs';
import { toModelDescriptor, requiredArguments, optionalArguments, schemaBytes } from './capability.mjs';

export const FILTER_REASONS = Object.freeze({
  DOMAIN_NOT_SELECTED: 'DOMAIN_NOT_SELECTED',
  CAPABILITY_DISABLED: 'CAPABILITY_DISABLED',
  PERMISSION_NOT_GRANTED: 'PERMISSION_NOT_GRANTED',
  PREREQUISITE_UNAVAILABLE: 'PREREQUISITE_UNAVAILABLE',
  EXCEEDS_EXPOSURE_CAP: 'EXCEEDS_EXPOSURE_CAP',
  REGISTRY_EMPTY: 'REGISTRY_EMPTY'
});

/**
 * @typedef {object} CapabilityContext
 * @property {string} snapshotId
 * @property {string} registryHash
 * @property {string} contextHash
 * @property {string} actorId
 * @property {string} workspaceId
 * @property {string} createdAt
 * @property {{ id: string, version: number }[]} capabilities  The snapshot's capability identities.
 * @property {string[]} ids                    Exposed capability ids, in presentation order.
 * @property {Record<string, string>} definitionHashes  id -> definitionHash for the exposed set.
 * @property {Record<string, unknown>[]} descriptors     Model-safe descriptors.
 * @property {{ id: string, reason: string }[]} filtered Excluded capabilities with reasons.
 * @property {string[]} candidates             Capability ids considered before filtering.
 * @property {string[]} domains                Domains selected for this turn.
 * @property {string[]} taskKeywords
 * @property {string} text                     Rendered context text (what the model sees).
 * @property {{ capabilityCount: number, schemaBytes: number, textChars: number, approxTokens: number }} budget
 * @property {number} registrySize
 */

/**
 * Build the capability context for one turn.
 * @param {object} options
 * @param {import('./registry.mjs').Registry} options.registry
 * @param {{ exposure: { maxCapabilities: number, domains: string[] }, policy: { grantedPermissions: string[] }, identity?: { actorId: string, workspaceId: string } }} options.config
 * @param {string} options.taskText
 * @param {() => string} [options.nowIso]
 * @param {(checkId: string, capabilityId: string) => { available: boolean, detail?: string }} [options.prerequisite]
 * @returns {CapabilityContext}
 */
export function buildCapabilityContext(options) {
  const { registry, config, taskText } = options;
  const prerequisite = options.prerequisite ?? (() => ({ available: true }));
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const identity = config.identity ?? { actorId: 'operator-local', workspaceId: 'default' };
  const keywords = extractKeywords(taskText);
  const all = registry.list();
  const allowedDomains = new Set(config.exposure.domains);
  const granted = new Set(config.policy.grantedPermissions);

  /** @type {{ id: string, reason: string }[]} */
  const filtered = [];
  /** @type {{ capability: import('./capability.mjs').Capability, score: number, index: number }[]} */
  const considered = [];

  all.forEach((capability, index) => {
    if (!capability.enabled) {
      filtered.push({ id: capability.id, reason: FILTER_REASONS.CAPABILITY_DISABLED });
      return;
    }
    if (allowedDomains.size > 0 && !allowedDomains.has(capability.domain)) {
      filtered.push({ id: capability.id, reason: FILTER_REASONS.DOMAIN_NOT_SELECTED });
      return;
    }
    const missing = capability.requiredPermissions.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      filtered.push({ id: capability.id, reason: FILTER_REASONS.PERMISSION_NOT_GRANTED });
      return;
    }
    considered.push({ capability, score: relevanceScore(capability, keywords), index });
  });

  considered.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  /** @type {import('./capability.mjs').Capability[]} */
  const exposed = [];
  for (const entry of considered) {
    const unmet = entry.capability.prerequisites.checks.filter((checkId) => {
      try {
        return prerequisite(checkId, entry.capability.id).available !== true;
      } catch {
        return true;
      }
    });
    if (unmet.length > 0) {
      filtered.push({ id: entry.capability.id, reason: FILTER_REASONS.PREREQUISITE_UNAVAILABLE });
      continue;
    }
    if (exposed.length >= config.exposure.maxCapabilities) {
      filtered.push({ id: entry.capability.id, reason: FILTER_REASONS.EXCEEDS_EXPOSURE_CAP });
      continue;
    }
    exposed.push(entry.capability);
  }

  if (all.length === 0) filtered.push({ id: '(registry)', reason: FILTER_REASONS.REGISTRY_EMPTY });

  const exposedIds = new Set(exposed.map((c) => c.id));
  // Related-capability references are filtered to the exposed set: the model is never told
  // about an operation it cannot use, not even as a cross-reference.
  const descriptors = exposed.map((c) => {
    const descriptor = toModelDescriptor(c);
    return {
      ...descriptor,
      relatedCapabilities: /** @type {string[]} */ (descriptor.relatedCapabilities).filter((id) => exposedIds.has(id))
    };
  });
  const text = renderContextText(descriptors);
  const ids = exposed.map((c) => c.id);
  /** @type {Record<string, string>} */
  const definitionHashes = {};
  for (const capability of exposed) definitionHashes[capability.id] = capability.definitionHash;

  const schemaTotal = exposed.reduce((sum, c) => sum + schemaBytes(c), 0);

  return {
    snapshotId: makeId('ctx'),
    registryHash: registry.hash(),
    contextHash: sha256Hex(canonicalJson({ ids, definitionHashes, text })),
    actorId: identity.actorId,
    workspaceId: identity.workspaceId,
    createdAt: nowIso(),
    capabilities: exposed.map((c) => ({ id: c.id, version: c.version })),
    ids,
    definitionHashes,
    descriptors,
    filtered,
    candidates: all.map((c) => c.id),
    domains: [...config.exposure.domains],
    taskKeywords: keywords,
    text,
    budget: {
      capabilityCount: exposed.length,
      schemaBytes: schemaTotal,
      textChars: text.length,
      approxTokens: approxTokens(text)
    },
    registrySize: all.length
  };
}

/**
 * Deterministic relevance: tag hits weigh most, then id tokens, then description words.
 * No embeddings, no randomness (addendum §3).
 * @param {import('./capability.mjs').Capability} capability
 * @param {string[]} keywords
 * @returns {number}
 */
export function relevanceScore(capability, keywords) {
  if (keywords.length === 0) return 0;
  const tags = new Set(capability.tags);
  const idTokens = new Set(capability.id.split(/[._]/));
  const text = `${capability.description} ${capability.whenToUse} ${capability.whenNotToUse}`.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (tags.has(keyword)) score += 3;
    if (idTokens.has(keyword)) score += 2;
    if (text.includes(keyword)) score += 1;
  }
  return score;
}

/**
 * Render the model-facing context. Deliberately textual and compact: small local models do
 * better with explicit labelled fields than with raw JSON Schema (addendum §4, §11).
 * @param {Record<string, unknown>[]} descriptors
 * @returns {string}
 */
export function renderContextText(descriptors) {
  if (descriptors.length === 0) {
    return 'No capability is currently available for this task.';
  }
  const blocks = descriptors.map((d) => {
    const required = /** @type {string[]} */ (d.requiredArguments);
    const optional = /** @type {string[]} */ (d.optionalArguments);
    const constraints = /** @type {Record<string, string>} */ (d.argumentConstraints);
    const constraintsText = [...required, ...optional]
      .map((name) => `      ${name}: ${constraints[name] ?? 'any'}`)
      .join('\n');
    const prerequisites = /** @type {string[]} */ (d.prerequisites);
    return [
      `- id: ${String(d.id)}`,
      `  domain: ${String(d.domain)}`,
      `  does: ${String(d.description)}`,
      `  use_when: ${String(d.whenToUse)}`,
      `  do_not_use_when: ${String(d.whenNotToUse)}`,
      `  required_arguments: ${required.length > 0 ? required.join(', ') : 'none'}`,
      `  optional_arguments: ${optional.length > 0 ? optional.join(', ') : 'none'}`,
      constraintsText ? `  argument_details:\n${constraintsText}` : '  argument_details: none',
      `  output: ${String(d.outputSummary)}`,
      `  side_effects: ${/** @type {string[]} */ (d.sideEffects).join('; ')}`,
      `  risk: ${String(d.risk)}`,
      `  retry_safety: ${String(d.idempotency)}`,
      `  confirmation: ${d.confirmationRequired === true ? 'REQUIRED before execution' : 'not required'}`,
      `  requires_permission: ${/** @type {string[]} */ (d.requiredPermissions).join(', ')}`,
      `  prerequisites: ${prerequisites.length > 0 ? prerequisites.join('; ') : 'none'}`,
      `  related: ${/** @type {string[]} */ (d.relatedCapabilities).join(', ') || 'none'}`
    ].join('\n');
  });
  return blocks.join('\n\n');
}

export { requiredArguments, optionalArguments };
