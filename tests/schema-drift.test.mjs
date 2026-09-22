/**
 * Decode/runtime schema-drift guard (Milestone 1.2).
 *
 * Two schemas exist on purpose:
 *   ENVELOPE_FORMAT_SCHEMA — what the ENGINE is asked to emit (every field required, empty-string
 *                             conventions for inapplicable ones). A grammar can only enforce what
 *                             a schema requires (research R-16; docs/LIVE_MODEL_VALIDATION.md).
 *   ENVELOPE_SCHEMA        — what the harness ACCEPTS (per-kind form allowed, conditionals enforced
 *                             in code by the parser).
 *
 * These two can silently drift apart: rename a field in one and the live decode constraint stops
 * matching what the parser reads, or the parser starts rejecting the very form the engine was
 * asked to produce. This test makes that drift a build failure.
 *
 * @module tests/schema-drift
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_FORMAT_SCHEMA, ENVELOPE_SCHEMA } from '../src/models/prompt.mjs';
import { parseEnvelope } from '../src/models/response-parser.mjs';
import { assertSupportedSchema } from '../src/core/schema.mjs';

test('every field the engine is told to emit is a field the harness accepts', () => {
  const formatProperties = Object.keys(/** @type {Record<string, unknown>} */ (ENVELOPE_FORMAT_SCHEMA.properties));
  const acceptedProperties = Object.keys(/** @type {Record<string, unknown>} */ (ENVELOPE_SCHEMA.properties));
  for (const field of formatProperties) {
    assert.ok(
      acceptedProperties.includes(field),
      `the decode schema requires "${field}" but the runtime envelope schema does not accept it — the engine would be asked for a field the parser rejects`
    );
  }
});

test('every field the decode schema requires is also named in the runtime schema', () => {
  const required = /** @type {string[]} */ (ENVELOPE_FORMAT_SCHEMA.required);
  assert.ok(required.length >= 6, 'the decode schema is expected to require every envelope field');
  for (const field of required) {
    assert.ok(
      Object.keys(/** @type {Record<string, unknown>} */ (ENVELOPE_SCHEMA.properties)).includes(field),
      `"${field}" is required by the decode schema but is not a runtime envelope property`
    );
  }
});

test('the exact form the engine is asked to emit parses, for every kind', () => {
  const allFieldsRequired = /** @type {string[]} */ (ENVELOPE_FORMAT_SCHEMA.required);
  assert.deepEqual([...allFieldsRequired].sort(), ['arguments', 'capability', 'kind', 'question', 'reason', 'reasoningSummary']);
  const shapes = [
    { kind: 'proposal', capability: 'customer.search', arguments: { query: 'Smith' }, question: '', reason: '', reasoningSummary: 'lookup' },
    { kind: 'clarification', capability: '', arguments: {}, question: 'Which invoice?', reason: '', reasoningSummary: 'need the id' },
    { kind: 'unsupported', capability: '', arguments: {}, question: '', reason: 'no capability moves money', reasoningSummary: 'unsupported' }
  ];
  for (const shape of shapes) {
    for (const field of allFieldsRequired) {
      assert.ok(field in shape, `the drift guard itself is stale: "${field}" missing from the ${shape.kind} fixture`);
    }
    assert.equal(parseEnvelope(JSON.stringify(shape)).kind, shape.kind);
  }
});

test('both schemas stay inside the validator-supported subset', () => {
  assertSupportedSchema(/** @type {Record<string, unknown>} */ (ENVELOPE_FORMAT_SCHEMA), 'envelope format schema');
  assertSupportedSchema(/** @type {Record<string, unknown>} */ (ENVELOPE_SCHEMA), 'envelope runtime schema');
});
