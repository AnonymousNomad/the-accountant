/**
 * Contract tests: canonical hashing, the schema engine, and response parsing.
 *
 * These are the boundaries where untrusted text becomes structured input, so the tests focus
 * on refusing things rather than accepting them.
 *
 * @module tests/contracts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hashAction, chainHash } from '../src/core/canonical.mjs';
import { validate, assertSupportedSchema, isPlaceholder } from '../src/core/schema.mjs';
import { parseEnvelope, extractSingleJsonObject } from '../src/models/response-parser.mjs';
import { ENVELOPE_SCHEMA } from '../src/models/prompt.mjs';

test('canonical JSON sorts keys, keeps array order and refuses non-finite numbers', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}');
  assert.equal(canonicalJson({ z: undefined, a: 1 }), '{"a":1}');
  assert.throws(() => canonicalJson({ a: Number.NaN }), /non-finite/);
});

test('the action hash depends on the capability and every argument value', () => {
  const base = hashAction('invoice.issue', { invoiceId: 'INV-0004' });
  assert.equal(base, hashAction('invoice.issue', { invoiceId: 'INV-0004' }));
  assert.notEqual(base, hashAction('invoice.issue', { invoiceId: 'INV-0003' }));
  assert.notEqual(base, hashAction('invoice.preview', { invoiceId: 'INV-0004' }));
  assert.match(base, /^[0-9a-f]{64}$/);
});

test('the chain hash changes when any earlier record changes', () => {
  const a = chainHash(null, { seq: 1, type: 'PROPOSED' });
  const b = chainHash(a, { seq: 2, type: 'VERIFIED' });
  assert.notEqual(a, b);
  assert.notEqual(b, chainHash(a, { seq: 2, type: 'EXECUTION_FAILED' }));
});

test('the schema engine accepts the documented subset and reports issues with paths', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['invoiceId'],
    properties: {
      invoiceId: { type: 'string', pattern: '^INV-[0-9]{4}$', nonPlaceholder: true },
      note: { type: 'string', maxLength: 5 }
    }
  };
  assert.deepEqual(validate({ invoiceId: 'INV-0004' }, schema), []);
  const issues = validate({ invoiceId: 'nope', note: 'far too long', extra: 1 }, schema);
  const keywords = issues.map((issue) => issue.keyword).sort();
  assert.deepEqual(keywords, ['additionalProperties', 'maxLength', 'pattern']);
  assert.ok(issues.every((issue) => issue.path.startsWith('$')));
});

test('unsupported schema keywords are refused at registration, not ignored', () => {
  assert.throws(() => assertSupportedSchema({ type: 'object', oneOf: [] }, 'test'), /unsupported keyword "oneOf"/);
  assert.throws(() => assertSupportedSchema({ type: 'object', additionalProperties: true }, 'test'), /additionalProperties must be false/);
  /** @type {Record<string, unknown>} */
  let deep = { type: 'string' };
  for (let level = 0; level < 8; level += 1) {
    deep = { type: 'object', properties: { [`level${level}`]: deep } };
  }
  assert.throws(() => assertSupportedSchema(deep, 'deep'), /nesting exceeds/);
});

test('placeholder values are detected only where a schema opts in', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', nonPlaceholder: true } } };
  assert.equal(validate({ name: 'N/A' }, schema).length, 1);
  assert.equal(validate({ name: 'Unknown' }, schema).length, 1);
  assert.equal(validate({ name: 'Acme Electrical' }, schema).length, 0);
  assert.equal(isPlaceholder('  TBD '), true);
  const withoutOptIn = { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } };
  assert.equal(validate({ name: 'N/A' }, withoutOptIn).length, 0, 'no opt-in means no placeholder rule');
});

test('the envelope schema is inside the supported subset', () => {
  assertSupportedSchema(/** @type {Record<string, unknown>} */ (ENVELOPE_SCHEMA), 'envelope');
});

test('exactly one JSON object is accepted; prose, fences and truncation are refused', () => {
  const ok = '{"kind":"unsupported","reason":"no","reasoningSummary":"why"}';
  assert.equal(parseEnvelope(ok).kind, 'unsupported');
  assert.equal(parseEnvelope(`\`\`\`json\n${ok}\n\`\`\``).kind, 'unsupported');
  assert.throws(() => parseEnvelope(`Here you go: ${ok}`), /not a JSON object/);
  assert.throws(() => parseEnvelope(`${ok} and another {"a":1}`), /content after the JSON object/);
  assert.throws(() => parseEnvelope('{"kind":"proposal",'), /unterminated/);
  assert.throws(() => parseEnvelope('[]'), /not a JSON object/);
});

test('the envelope validator enforces per-kind fields and rejects authority fields', () => {
  const base = { kind: 'proposal', reasoningSummary: 'why' };
  assert.throws(() => parseEnvelope(JSON.stringify({ ...base, capability: 'x.y' })), /proposalId/);
  assert.throws(() => parseEnvelope(JSON.stringify({ ...base, proposalId: 'p1', capability: 'customer.create' })), /arguments/);
  assert.throws(
    () => parseEnvelope(JSON.stringify({ ...base, proposalId: 'p1', capability: 'customer.create', arguments: {}, risk: 'READ' })),
    /risk is not an allowed field/
  );
  assert.throws(() => parseEnvelope(JSON.stringify({ kind: 'clarification', reasoningSummary: 'x' })), /question/);
  assert.throws(() => parseEnvelope(JSON.stringify({ kind: 'clarification', question: 'Which one?', reasoningSummary: 'x', capability: 'y.z' })), /must not contain/);
  assert.throws(() => parseEnvelope(JSON.stringify({ kind: 'nonsense', reasoningSummary: 'x' })), /enum|must be one of/);
});

test('extractSingleJsonObject handles braces and escapes inside strings', () => {
  const value = extractSingleJsonObject('{"memo":"a } brace and \\" quote","n":1}');
  assert.deepEqual(value, { memo: 'a } brace and " quote', n: 1 });
});
