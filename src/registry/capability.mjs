/**
 * Capability definitions: the trusted contract for one semantic operation.
 *
 * A capability is the ONLY unit of authority the model can name. It is defined here (in
 * trusted code or trusted configuration), never inferred from a route table, never invented
 * by a model, and never partially specified: registration fails unless every field a human
 * would need to review — description, usage guidance, risk, permission, side effects,
 * adapter binding, verifier, prerequisites — is present and valid.
 *
 * Model-safe metadata (what the model is told) is derived from this definition by
 * `toModelDescriptor`. Internal details (adapter kind, operation/binding names, HTTP methods
 * and paths) are deliberately absent from the descriptor: the model selects an operation,
 * trusted configuration decides how it is carried out (research R-30, the confused-deputy
 * problem).
 *
 * @module registry/capability
 */

import { CapabilityError, CODES } from '../core/errors.mjs';
import { assertSupportedSchema, COMPLEXITY_BUDGET } from '../core/schema.mjs';
import { assertRiskClass, RISK } from '../policy/risk.mjs';
import { sha256Hex, canonicalJson } from '../core/canonical.mjs';
import { deepFreeze } from '../core/util.mjs';

const ALLOWED_KEYS = Object.freeze([
  'id',
  'version',
  'description',
  'whenToUse',
  'whenNotToUse',
  'domain',
  'risk',
  'inputSchema',
  'outputSummary',
  'requiredPermissions',
  'requiresConfirmation',
  'sideEffects',
  'prerequisites',
  'relatedCapabilities',
  'tags',
  'adapter',
  'verifier',
  'enabled',
  'idempotency',
  'sensitivity'
]);

export const ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const DOMAIN_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** Retry-safety classification recorded in trusted metadata (never inferred from HTTP method). */
export const IDEMPOTENCY = Object.freeze({
  NATURALLY_IDEMPOTENT: 'naturally_idempotent',
  KEY_SUPPORTED: 'idempotency_key_supported',
  NON_IDEMPOTENT: 'non_idempotent'
});

export const SENSITIVITY = Object.freeze(['low', 'moderate', 'high']);

/**
 * @typedef {object} Capability
 * @property {string} id
 * @property {number} version
 * @property {string} description
 * @property {string} whenToUse
 * @property {string} whenNotToUse
 * @property {string} domain
 * @property {string} risk
 * @property {Record<string, unknown>} inputSchema
 * @property {string} outputSummary
 * @property {string[]} requiredPermissions
 * @property {boolean} requiresConfirmation
 * @property {string[]} sideEffects
 * @property {{ descriptions: string[], checks: string[] }} prerequisites
 * @property {string[]} relatedCapabilities
 * @property {string[]} tags
 * @property {{ kind: 'mock'|'http', operation?: string, binding?: string }} adapter
 * @property {string} verifier
 * @property {boolean} enabled
 * @property {string} idempotency
 * @property {string} sensitivity
 * @property {string} definitionHash
 */

/**
 * Validate and freeze a capability definition. Throws on anything questionable.
 * @param {Record<string, unknown>} input
 * @returns {Capability}
 */
export function defineCapability(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, 'capability definition must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability has unknown field "${key}"`);
    }
  }

  const id = requireString(input.id, 'id', 3, 64);
  if (!ID_PATTERN.test(id)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability id "${id}" must look like domain.verb (lowercase, dotted)`);
  }
  const version = typeof input.version === 'number' && Number.isInteger(input.version) && input.version >= 1 ? input.version : 1;
  const description = requireString(input.description, 'description', 20, 400);
  const whenToUse = requireString(input.whenToUse, 'whenToUse', 20, 400);
  const whenNotToUse = requireString(input.whenNotToUse, 'whenNotToUse', 10, 400);
  const domain = requireString(input.domain, 'domain', 3, 64);
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `domain "${domain}" must be lowercase dotted`);
  }
  const risk = assertRiskClass(input.risk);
  const outputSummary = requireString(input.outputSummary, 'outputSummary', 5, 300);
  const requiredPermissions = requireStringArray(input.requiredPermissions, 'requiredPermissions', 1, 8);
  const sideEffects = requireStringArray(input.sideEffects, 'sideEffects', 1, 8);
  const tags = requireStringArray(input.tags, 'tags', 1, 24);
  const relatedCapabilities = requireStringArray(input.relatedCapabilities ?? [], 'relatedCapabilities', 0, 12, CAPABILITY_ID_SHAPE);

  const requiresConfirmation = input.requiresConfirmation === true;
  if (risk === RISK.FINANCIAL && !requiresConfirmation) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": FINANCIAL risk requires requiresConfirmation: true`);
  }

  const inputSchema = input.inputSchema;
  if (inputSchema === null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": inputSchema must be an object`);
  }
  const schema = /** @type {Record<string, unknown>} */ (inputSchema);
  if (schema.type !== 'object') {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": inputSchema.type must be "object"`);
  }
  if (schema.additionalProperties !== false) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": inputSchema.additionalProperties must be false`);
  }
  assertSupportedSchema(schema, `capability ${id}.inputSchema`);

  const prerequisites = normalizePrerequisites(input.prerequisites, id);
  const adapter = normalizeAdapter(input.adapter, id);
  const verifier = requireString(input.verifier, 'verifier', 2, 64);

  const enabled = input.enabled === undefined ? true : input.enabled === true;
  const idempotency =
    input.idempotency === undefined ? IDEMPOTENCY.KEY_SUPPORTED : assertEnum(input.idempotency, Object.values(IDEMPOTENCY), 'idempotency');
  const sensitivity = input.sensitivity === undefined ? 'moderate' : assertEnum(input.sensitivity, SENSITIVITY, 'sensitivity');
  if ((risk === RISK.FINANCIAL || risk === RISK.MUTATION) && idempotency === IDEMPOTENCY.NATURALLY_IDEMPOTENT) {
    throw new CapabilityError(
      CODES.CAPABILITY_INVALID,
      `capability "${id}": a ${risk} operation must not claim to be naturally_idempotent; record an explicit idempotency policy instead`
    );
  }

  const definition = {
    id,
    version,
    description,
    whenToUse,
    whenNotToUse,
    domain,
    risk,
    inputSchema: schema,
    outputSummary,
    requiredPermissions,
    requiresConfirmation,
    sideEffects,
    prerequisites,
    relatedCapabilities,
    tags,
    adapter,
    verifier,
    enabled,
    idempotency,
    sensitivity
  };
  const definitionHash = sha256Hex(canonicalJson(definition));
  return /** @type {Capability} */ (deepFreeze({ ...definition, definitionHash }));
}

const CAPABILITY_ID_SHAPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * @param {unknown} value
 * @param {string} id
 * @returns {{ descriptions: string[], checks: string[] }}
 */
function normalizePrerequisites(value, id) {
  if (value === undefined) return { descriptions: [], checks: [] };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": prerequisites must be an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(record)) {
    if (!['descriptions', 'checks'].includes(key)) {
      throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": prerequisites has unknown field "${key}"`);
    }
  }
  return {
    descriptions: requireStringArray(record.descriptions ?? [], 'prerequisites.descriptions', 0, 6),
    checks: requireStringArray(record.checks ?? [], 'prerequisites.checks', 0, 6, /^[a-z][a-z0-9_.]*$/)
  };
}

/**
 * @param {unknown} value
 * @param {string} id
 * @returns {{ kind: 'mock'|'http', operation?: string, binding?: string }}
 */
function normalizeAdapter(value, id) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": adapter must be an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const kind = record.kind;
  if (kind === 'mock') {
    const operation = requireString(record.operation, 'adapter.operation', 2, 64);
    return { kind: 'mock', operation };
  }
  if (kind === 'http') {
    const binding = requireString(record.binding, 'adapter.binding', 2, 64);
    return { kind: 'http', binding };
  }
  throw new CapabilityError(CODES.CAPABILITY_INVALID, `capability "${id}": adapter.kind must be "mock" or "http"`);
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} field
 * @returns {string}
 */
function assertEnum(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `${field} must be one of ${allowed.join(', ')}; got ${String(value)}`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {string}
 */
function requireString(value, field, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `${field} must be a string of ${min}-${max} characters`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @param {RegExp} [pattern]
 * @returns {string[]}
 */
function requireStringArray(value, field, min, max, pattern) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `${field} must be an array of ${min}-${max} entries`);
  }
  /** @type {string[]} */
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 160) {
      throw new CapabilityError(CODES.CAPABILITY_INVALID, `${field} entries must be strings of 1-160 characters`);
    }
    if (pattern && !pattern.test(entry)) {
      throw new CapabilityError(CODES.CAPABILITY_INVALID, `${field} entry "${entry}" has an invalid shape`);
    }
    out.push(entry);
  }
  if (new Set(out).size !== out.length) {
    throw new CapabilityError(CODES.CAPABILITY_INVALID, `${field} contains duplicates`);
  }
  return out;
}

/**
 * @param {Capability} capability
 * @returns {string[]}
 */
export function requiredArguments(capability) {
  const required = capability.inputSchema.required;
  return Array.isArray(required) ? required.map(String) : [];
}

/**
 * @param {Capability} capability
 * @returns {string[]}
 */
export function optionalArguments(capability) {
  const properties = /** @type {Record<string, unknown>} */ (capability.inputSchema.properties ?? {});
  const required = new Set(requiredArguments(capability));
  return Object.keys(properties).filter((name) => !required.has(name));
}

/**
 * Model-safe descriptor: what the model is allowed to know about a capability.
 * Deliberately excludes adapter kind, operation/binding names, and any transport detail.
 * @param {Capability} capability
 * @returns {Record<string, unknown>}
 */
export function toModelDescriptor(capability) {
  return deepFreeze({
    id: capability.id,
    domain: capability.domain,
    description: capability.description,
    whenToUse: capability.whenToUse,
    whenNotToUse: capability.whenNotToUse,
    requiredArguments: requiredArguments(capability),
    optionalArguments: optionalArguments(capability),
    argumentConstraints: renderArgumentConstraints(capability),
    outputSummary: capability.outputSummary,
    sideEffects: capability.sideEffects,
    risk: capability.risk,
    confirmationRequired: capability.requiresConfirmation,
    requiredPermissions: capability.requiredPermissions,
    prerequisites: capability.prerequisites.descriptions,
    relatedCapabilities: capability.relatedCapabilities,
    idempotency: capability.idempotency,
    version: capability.version,
    definitionHash: capability.definitionHash
  });
}

/**
 * @param {Capability} capability
 * @returns {Record<string, string>}
 */
export function renderArgumentConstraints(capability) {
  /** @type {Record<string, string>} */
  const out = {};
  const properties = /** @type {Record<string, Record<string, unknown>>} */ (capability.inputSchema.properties ?? {});
  for (const [name, schema] of Object.entries(properties)) {
    out[name] = describeSchema(schema);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} schema
 * @returns {string}
 */
function describeSchema(schema) {
  const parts = [];
  const type = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
  if (type) parts.push(String(type));
  if (Array.isArray(schema.enum)) parts.push(`one of ${schema.enum.map((v) => String(v)).join('|')}`);
  if (typeof schema.minLength === 'number' || typeof schema.maxLength === 'number') {
    parts.push(`${schema.minLength ?? 0}-${schema.maxLength ?? '∞'} chars`);
  }
  if (typeof schema.pattern === 'string') parts.push(`matches ${schema.pattern}`);
  if (typeof schema.minimum === 'number' || typeof schema.maximum === 'number') {
    parts.push(`range ${schema.minimum ?? '-∞'}..${schema.maximum ?? '∞'}`);
  }
  if (typeof schema.minItems === 'number' || typeof schema.maxItems === 'number') {
    parts.push(`${schema.minItems ?? 0}-${schema.maxItems ?? '∞'} items`);
  }
  if (schema.nonPlaceholder === true) parts.push('real value required');
  return parts.join(', ') || 'any';
}

/**
 * Complexity accounting for the context budget (docs/BENCHMARK.md §context budget).
 * @param {Capability} capability
 * @returns {number}
 */
export function schemaBytes(capability) {
  return canonicalJson(capability.inputSchema).length;
}

export { COMPLEXITY_BUDGET };
