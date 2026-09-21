/**
 * A deliberately bounded JSON Schema validator.
 *
 * Rationale (research R-15/R-16): constrained-decoding engines silently skip unsupported
 * schema keywords, so a schema is never proof. The harness therefore has its own validator
 * whose supported keyword set is explicit and tested, and refuses to accept a schema that
 * uses anything outside that set. This makes "the schema says X" a claim the harness can
 * actually enforce.
 *
 * Supported keywords: type (string or array of strings), enum, properties, required,
 * additionalProperties (only `false` is accepted), items, minItems, maxItems, minLength,
 * maxLength, pattern, minimum, maximum, nonPlaceholder, description.
 *
 * @module core/schema
 */

import { SchemaError, CODES } from './errors.mjs';

export const SUPPORTED_KEYWORDS = Object.freeze([
  'type',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'nonPlaceholder',
  'description'
]);

export const COMPLEXITY_BUDGET = Object.freeze({
  maxDepth: 6,
  maxPropertiesPerObject: 24,
  maxEnumValues: 32
});

/**
 * @typedef {object} SchemaIssue
 * @property {string} path   JSON-pointer-ish path, e.g. `$.customerId`
 * @property {string} keyword
 * @property {string} message
 */

/**
 * Throw unless the schema is inside the supported subset and complexity budget.
 * Called at capability registration and at config load: fail at build time, not at run time.
 * @param {unknown} schema
 * @param {string} [label]
 * @returns {void}
 */
export function assertSupportedSchema(schema, label = 'schema') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: schema must be an object`);
  }
  walk(/** @type {Record<string, unknown>} */ (schema), '$', 0, label);
}

/**
 * @param {Record<string, unknown>} schema
 * @param {string} path
 * @param {number} depth
 * @param {string} label
 */
function walk(schema, path, depth, label) {
  if (depth > COMPLEXITY_BUDGET.maxDepth) {
    throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: nesting exceeds ${COMPLEXITY_BUDGET.maxDepth} at ${path}`);
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.includes(key)) {
      throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: unsupported keyword "${key}" at ${path}`);
    }
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(t))) {
        throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: unsupported type "${String(t)}" at ${path}`);
      }
    }
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: enum must be a non-empty array at ${path}`);
    }
    if (schema.enum.length > COMPLEXITY_BUDGET.maxEnumValues) {
      throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: enum exceeds ${COMPLEXITY_BUDGET.maxEnumValues} values at ${path}`);
    }
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new SchemaError(
      CODES.SCHEMA_UNSUPPORTED,
      `${label}: additionalProperties must be false at ${path} (unknown fields must be rejected)`
    );
  }
  const props = schema.properties;
  if (props !== undefined) {
    if (props === null || typeof props !== 'object' || Array.isArray(props)) {
      throw new SchemaError(CODES.SCHEMA_UNSUPPORTED, `${label}: properties must be an object at ${path}`);
    }
    const names = Object.keys(/** @type {Record<string, unknown>} */ (props));
    if (names.length > COMPLEXITY_BUDGET.maxPropertiesPerObject) {
      throw new SchemaError(
        CODES.SCHEMA_UNSUPPORTED,
        `${label}: ${names.length} properties exceeds ${COMPLEXITY_BUDGET.maxPropertiesPerObject} at ${path}`
      );
    }
    for (const name of names) {
      const child = /** @type {Record<string, unknown>} */ (props)[name];
      walk(/** @type {Record<string, unknown>} */ (child), `${path}.${name}`, depth + 1, label);
    }
  }
  if (schema.items !== undefined) {
    walk(/** @type {Record<string, unknown>} */ (schema.items), `${path}[]`, depth + 1, label);
  }
}

/**
 * Validate a value against a schema. Returns all issues (never throws for data violations).
 * A schema outside the supported subset throws (that is a programming/registration error).
 * @param {unknown} value
 * @param {Record<string, unknown>} schema
 * @param {string} [path]
 * @returns {SchemaIssue[]}
 */
export function validate(value, schema, path = '$') {
  assertSupportedSchema(schema, path);
  /** @type {SchemaIssue[]} */
  const issues = [];
  validateInner(value, schema, path, issues);
  return issues;
}

/**
 * @param {unknown} value
 * @param {Record<string, unknown>} schema
 * @param {string} path
 * @param {SchemaIssue[]} issues
 */
function validateInner(value, schema, path, issues) {
  const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];

  if (types && !types.some((t) => matchesType(value, String(t)))) {
    issues.push({ path, keyword: 'type', message: `expected ${types.join('|')}` });
    return;
  }

  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum;
    if (!allowed.some((candidate) => canonicalEqual(candidate, value))) {
      issues.push({
        path,
        keyword: 'enum',
        message: `must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')}`
      });
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ path, keyword: 'minLength', message: `must be at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ path, keyword: 'maxLength', message: `must be at most ${schema.maxLength} characters` });
    }
    if (typeof schema.pattern === 'string') {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        issues.push({ path, keyword: 'pattern', message: `must match ${schema.pattern}` });
      }
    }
    if (schema.nonPlaceholder === true && isPlaceholder(value)) {
      issues.push({ path, keyword: 'nonPlaceholder', message: 'must be a real value, not a placeholder' });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ path, keyword: 'minimum', message: `must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ path, keyword: 'maximum', message: `must be <= ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ path, keyword: 'minItems', message: `must contain at least ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ path, keyword: 'maxItems', message: `must contain at most ${schema.maxItems} items` });
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateInner(item, /** @type {Record<string, unknown>} */ (schema.items), `${path}[${index}]`, issues);
      });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = /** @type {Record<string, unknown>} */ (value);
    const props = /** @type {Record<string, Record<string, unknown>>} */ (schema.properties ?? {});
    const required = /** @type {string[]} */ (schema.required ?? []);
    for (const name of required) {
      if (!(name in record)) {
        issues.push({ path: `${path}.${name}`, keyword: 'required', message: 'is required' });
      }
    }
    for (const [key, child] of Object.entries(record)) {
      const childSchema = props[key];
      if (childSchema === undefined) {
        if (schema.additionalProperties === false) {
          issues.push({ path: `${path}.${key}`, keyword: 'additionalProperties', message: 'is not an allowed field' });
        }
        continue;
      }
      validateInner(child, childSchema, `${path}.${key}`, issues);
    }
  }
}

const PLACEHOLDERS = new Set(['', 'n/a', 'na', 'none', 'null', 'nil', 'missing', 'unknown', 'tbd', 'todo', '<unknown>', 'undefined', '?', '??', '...']);

/**
 * Placeholder detection (research R-20: models emit `"url": "Missing"` and similar).
 * Only applied where a schema opts in with `nonPlaceholder: true`.
 * @param {string} value
 * @returns {boolean}
 */
export function isPlaceholder(value) {
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

/**
 * @param {unknown} value
 * @param {string} type
 * @returns {boolean}
 */
function matchesType(value, type) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function canonicalEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
