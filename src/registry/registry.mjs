/**
 * The capability registry: one trusted machine-readable inventory of every operation the
 * harness can perform (addendum §1).
 *
 * The registry is sealed before use. Sealing validates cross-capability relations
 * (`relatedCapabilities` must resolve) so that a typo becomes a startup failure instead of a
 * silently missing tool that the model is never told about.
 *
 * @module registry/registry
 */

import { CapabilityError, CODES } from '../core/errors.mjs';
import { sha256Hex, canonicalJson } from '../core/canonical.mjs';
import { defineCapability, schemaBytes } from './capability.mjs';

/**
 * @typedef {import('./capability.mjs').Capability} Capability
 */

/**
 * @typedef {object} Registry
 * @property {(definition: Record<string, unknown>) => Capability} register
 * @property {(id: string) => Capability|undefined} get
 * @property {(id: string) => boolean} has
 * @property {() => Capability[]} list
 * @property {() => Capability[]} listEnabled
 * @property {() => void} seal
 * @property {() => boolean} isSealed
 * @property {() => string} hash
 * @property {() => number} size
 */

/**
 * @returns {Registry}
 */
export function createRegistry() {
  /** @type {Map<string, Capability>} */
  const capabilities = new Map();
  let sealed = false;
  /** @type {string|null} */
  let hashCache = null;

  return {
    /**
     * @param {Record<string, unknown>} definition
     * @returns {Capability}
     */
    register(definition) {
      if (sealed) {
        throw new CapabilityError(CODES.CAPABILITY_INVALID, 'registry is sealed; capabilities cannot change after startup');
      }
      const capability = defineCapability(definition);
      if (capabilities.has(capability.id)) {
        throw new CapabilityError(CODES.CAPABILITY_DUPLICATE, `capability "${capability.id}" is already registered`);
      }
      capabilities.set(capability.id, capability);
      hashCache = null;
      return capability;
    },

    /** @param {string} id */
    get(id) {
      return capabilities.get(id);
    },

    /** @param {string} id */
    has(id) {
      return capabilities.has(id);
    },

    list() {
      return [...capabilities.values()];
    },

    /** Disabled capabilities are never exposed and can never receive authority. */
    listEnabled() {
      return [...capabilities.values()].filter((capability) => capability.enabled);
    },

    seal() {
      for (const capability of capabilities.values()) {
        for (const related of capability.relatedCapabilities) {
          if (!capabilities.has(related)) {
            throw new CapabilityError(
              CODES.CAPABILITY_INVALID,
              `capability "${capability.id}" declares related capability "${related}" which is not registered`
            );
          }
        }
      }
      sealed = true;
      hashCache = null;
    },

    isSealed() {
      return sealed;
    },

    /** Registry identity: changes whenever any capability definition changes. */
    hash() {
      if (hashCache) return hashCache;
      const identity = [...capabilities.values()]
        .map((c) => ({ id: c.id, version: c.version, definitionHash: c.definitionHash, schemaBytes: schemaBytes(c) }))
        .sort((a, b) => a.id.localeCompare(b.id));
      hashCache = sha256Hex(canonicalJson(identity));
      return hashCache;
    },

    size() {
      return capabilities.size;
    }
  };
}
