/**
 * Manifest stability tests — the S19-class apparatus defects must not recur.
 *
 * @module tests/manifest
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, manifestHashOf } from '../benchmarks/manifest.mjs';

const BASE = {
  experiment: 'S99-TEST',
  tasks: [{ id: 'T001', repetition: 3 }, { id: 'T002', repetition: 3 }],
  repetitions: 3,
  envelope: { model: 'x.gguf', surface: 'bounded', selection: 'keyword', temperature: 0.1 },
  configTruth: { configPath: 'config/a.json', configFileSha256: 'aaa', effectiveConfigHash: 'bbb' }
};

test('the manifest hash is stable across restarts (volatile timestamps are excluded)', () => {
  const first = buildManifest(BASE, '2026-09-21T00:00:00.000Z');
  const second = buildManifest(BASE, '2026-09-22T11:22:33.000Z');
  assert.equal(manifestHashOf(first), manifestHashOf(second), 'resume must not be blocked by a clock');
  assert.equal(first.frozenAt, '2026-09-21T00:00:00.000Z', 'the timestamp is still recorded for provenance');
});

test('the manifest hash changes when the experiment identity, tasks or configuration truth changes', () => {
  const base = manifestHashOf(buildManifest(BASE));
  assert.notEqual(base, manifestHashOf(buildManifest({ ...BASE, experiment: 'S99-OTHER' })));
  assert.notEqual(base, manifestHashOf(buildManifest({ ...BASE, tasks: [{ id: 'T001', repetition: 3 }] })));
  assert.notEqual(base, manifestHashOf(buildManifest({ ...BASE, repetitions: 1 })));
  assert.notEqual(
    base,
    manifestHashOf(buildManifest({ ...BASE, envelope: { ...BASE.envelope, selection: 'expected-domain' } })),
    'a discovery-mode change is a different experiment'
  );
  assert.notEqual(
    base,
    manifestHashOf(buildManifest({ ...BASE, configTruth: { ...BASE.configTruth, effectiveConfigHash: 'ccc' } })),
    'a different effective configuration is a different experiment'
  );
});
