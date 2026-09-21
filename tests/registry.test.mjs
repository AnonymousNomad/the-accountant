/**
 * Registry tests: capability definition validation, the complexity budget, sealing, and the
 * rules that keep the registry trustworthy as an authority source.
 *
 * @module tests/registry
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/registry/registry.mjs';
import { defineCapability, toModelDescriptor, IDEMPOTENCY } from '../src/registry/capability.mjs';
import { syntheticAccountingCapabilities } from '../src/domain/synthetic-accounting/capabilities.mjs';

function validDefinition(overrides = {}) {
  return {
    id: 'thing.do_it',
    version: 1,
    description: 'Perform the synthetic thing that this capability exists to perform.',
    whenToUse: 'Use when the operator asks for the synthetic thing to be performed.',
    whenNotToUse: 'Do not use when the operator asked for something else entirely.',
    domain: 'synthetic.things',
    risk: 'MUTATION',
    outputSummary: 'The identifier of the thing that changed.',
    requiredPermissions: ['accounting.write'],
    requiresConfirmation: false,
    sideEffects: ['updates a synthetic record'],
    relatedCapabilities: [],
    tags: ['thing', 'synthetic'],
    inputSchema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 40 } } },
    adapter: { kind: 'mock', operation: 'thing.do_it' },
    verifier: 'thing.done',
    ...overrides
  };
}

test('a complete definition is accepted and frozen', () => {
  const capability = defineCapability(validDefinition());
  assert.equal(capability.id, 'thing.do_it');
  assert.equal(capability.enabled, true);
  assert.equal(capability.idempotency, IDEMPOTENCY.KEY_SUPPORTED);
  assert.equal(capability.sensitivity, 'moderate');
  assert.equal(Object.isFrozen(capability), true);
  assert.match(capability.definitionHash, /^[0-9a-f]{64}$/);
});

test('every field the model is shown is derived from trusted metadata', () => {
  const descriptor = toModelDescriptor(defineCapability(validDefinition()));
  assert.deepEqual(descriptor.requiredArguments, ['name']);
  assert.deepEqual(descriptor.optionalArguments, []);
  assert.equal(descriptor.risk, 'MUTATION');
  assert.equal(descriptor.version, 1);
  assert.match(String(/** @type {Record<string, string>} */ (descriptor.argumentConstraints).name), /1-40 chars/);
  assert.equal('adapter' in descriptor, false, 'transport details are never exposed to the model');
  assert.equal('verifier' in descriptor, false, 'internal verification wiring is never exposed');
});

test('definition problems are refused: id shape, short description, missing verifier, unknown fields', () => {
  assert.throws(() => defineCapability(validDefinition({ id: 'noundot' })), /must look like domain.verb/);
  assert.throws(() => defineCapability(validDefinition({ description: 'too short' })), /description must be/);
  assert.throws(() => defineCapability(validDefinition({ verifier: '' })), /verifier must be/);
  assert.throws(() => defineCapability(validDefinition({ surprise: true })), /unknown field "surprise"/);
  assert.throws(() => defineCapability(validDefinition({ requiredPermissions: [] })), /requiredPermissions must be an array of 1-8/);
});

test('risk cannot be forged and FINANCIAL must declare confirmation', () => {
  assert.throws(() => defineCapability(validDefinition({ risk: 'IMPORTANT' })), /risk must be one of/);
  assert.throws(() => defineCapability(validDefinition({ risk: 'FINANCIAL' })), /FINANCIAL risk requires requiresConfirmation: true/);
  assert.doesNotThrow(() => defineCapability(validDefinition({ risk: 'FINANCIAL', requiresConfirmation: true })));
});

test('a mutating operation may not claim to be naturally idempotent', () => {
  assert.throws(
    () => defineCapability(validDefinition({ risk: 'MUTATION', idempotency: 'naturally_idempotent' })),
    /must not claim to be naturally_idempotent/
  );
  assert.throws(
    () => defineCapability(validDefinition({ risk: 'FINANCIAL', requiresConfirmation: true, idempotency: 'naturally_idempotent' })),
    /must not claim to be naturally_idempotent/
  );
  assert.doesNotThrow(() => defineCapability(validDefinition({ risk: 'READ', idempotency: 'naturally_idempotent' })));
});

test('unsupported or over-complex input schemas are refused at registration', () => {
  assert.throws(() => defineCapability(validDefinition({ inputSchema: { type: 'object', additionalProperties: false, properties: { a: { oneOf: [] } } } })), /unsupported keyword/);
  const manyProperties = /** @type {any} */ ({ type: 'object', additionalProperties: false, properties: {} });
  for (let i = 0; i < 25; i += 1) manyProperties.properties[`p${i}`] = { type: 'string' };
  assert.throws(() => defineCapability(validDefinition({ inputSchema: manyProperties })), /exceeds 24/);
});

test('the registry refuses duplicates and refuses changes after sealing', () => {
  const registry = createRegistry();
  registry.register(validDefinition());
  assert.throws(() => registry.register(validDefinition()), /already registered/);
  registry.register(validDefinition({ id: 'thing.related_thing', verifier: 'thing.done', adapter: { kind: 'mock', operation: 'thing.related' } }));
  registry.seal();
  assert.throws(() => registry.register(validDefinition({ id: 'thing.late' })), /sealed/);
});

test('sealing validates relations and rejects dangling relatedCapabilities', () => {
  const registry = createRegistry();
  registry.register(validDefinition({ relatedCapabilities: ['thing.does_not_exist'] }));
  assert.throws(() => registry.seal(), /related capability "thing.does_not_exist" which is not registered/);
});

test('the shipped accounting pack registers, seals, and has stable identity', () => {
  const first = createRegistry();
  const second = createRegistry();
  for (const definition of syntheticAccountingCapabilities()) {
    first.register(definition);
    second.register(definition);
  }
  first.seal();
  second.seal();
  assert.equal(first.size(), 8);
  assert.deepEqual(first.hash(), second.hash());
  assert.deepEqual(
    first.list().map((c) => c.id),
    ['customer.search', 'customer.create', 'customer.update', 'invoice.create_draft', 'invoice.preview', 'invoice.issue', 'ledger.query', 'journal.propose']
  );
  assert.equal(first.listEnabled().length, 8);
});
