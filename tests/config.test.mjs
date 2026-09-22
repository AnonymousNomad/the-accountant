/**
 * Configuration tests: the harness refuses to start on an invalid or unsafe configuration, and
 * documented defaults never silently replace a security-relevant value.
 *
 * @module tests/config
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, CONFIG_DEFAULTS } from '../src/core/config.mjs';

async function withConfig(/** @type {any} */ overrides, /** @type {function(string, string): any} */ fn) {
  const dir = await mkdtemp(join(tmpdir(), 'sah-config-'));
  try {
    const base = {
      identity: { actorId: 'operator-local', workspaceId: 'synthetic-default' },
      provider: { kind: 'scripted', baseUrl: 'http://127.0.0.1:11434', model: 'm' },
      policy: { riskAllowlist: ['READ', 'DRAFT', 'MUTATION', 'FINANCIAL'], requireConfirmationFor: ['FINANCIAL'], grantedPermissions: ['accounting.read'] },
      confirmation: { ttlSeconds: 60 },
      authority: { permitTtlSeconds: 30 },
      exposure: { maxCapabilities: 8, domains: ['accounting.customers'] },
      adapters: { mock: { enabled: true }, http: { enabled: false, baseUrl: '', bindings: {}, headersFile: null } },
      evidence: { dir: 'var/evidence' },
      ...overrides
    };
    const file = join(dir, 'config', 'harness.config.json');
    await mkdir(join(dir, 'config'), { recursive: true });
    await writeFile(file, JSON.stringify(base), 'utf8');
    return await fn(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a valid configuration loads and reports its hash', async () => {
  await withConfig({}, (/** @type {string} */ file) => {
    const loaded = loadConfig(file);
    assert.equal(loaded.config.identity.actorId, 'operator-local');
    assert.match(loaded.configHash, /^[0-9a-f]{64}$/);
    assert.equal(loaded.httpHeaders, null);
  });
});

test('unknown keys and wrong types are refused', async () => {
  await withConfig({ surprise: true }, (/** @type {string} */ file) => {
    assert.throws(() => loadConfig(file), /invalid config/);
  });
  await withConfig({ provider: { kind: 'scripted', baseUrl: 'http://127.0.0.1:11434', model: 'm', timeoutMs: 5 } }, (file) => {
    assert.throws(() => loadConfig(file), /invalid config/);
  });
});

test('the harness will not start with unconfirmed financial authority', async () => {
  await withConfig({ policy: { riskAllowlist: ['READ'], requireConfirmationFor: [], grantedPermissions: [] } }, (file) => {
    assert.throws(() => loadConfig(file), /must include FINANCIAL/);
  });
});

test('unknown risk classes are refused', async () => {
  await withConfig({ policy: { riskAllowlist: ['READ', 'SCARY'], requireConfirmationFor: ['FINANCIAL'], grantedPermissions: [] } }, (file) => {
    assert.throws(() => loadConfig(file), /unknown risk class "SCARY"/);
  });
});

test('the http adapter cannot be enabled without a local base URL, and its bindings are validated', async () => {
  await withConfig({ adapters: { mock: { enabled: true }, http: { enabled: true, baseUrl: '', bindings: {}, headersFile: null } } }, (file) => {
    assert.throws(() => loadConfig(file), /baseUrl is empty/);
  });
  await withConfig(
    { adapters: { mock: { enabled: true }, http: { enabled: true, baseUrl: 'http://127.0.0.1:8080', bindings: { 'customer.create': { method: 'FETCH', path: '/x' } }, headersFile: null } } },
    (file) => {
      assert.throws(() => loadConfig(file), /unsupported method/);
    }
  );
  await withConfig(
    { adapters: { mock: { enabled: true }, http: { enabled: true, baseUrl: 'http://127.0.0.1:8080', bindings: { 'customer.create': { method: 'POST', path: 'no-leading-slash' } }, headersFile: null } } },
    (file) => {
      assert.throws(() => loadConfig(file), /path must start with/);
    }
  );
  await withConfig(
    { adapters: { mock: { enabled: true }, http: { enabled: true, baseUrl: 'http://10.0.0.5:8080', bindings: {}, headersFile: null } } },
    (file) => {
      assert.throws(() => loadConfig(file), /not loopback/);
    }
  );
});

test('a non-loopback model runtime is refused unless the operator explicitly opts in', async () => {
  await withConfig({ provider: { kind: 'ollama', baseUrl: 'http://example.com:11434', model: 'm' } }, (file) => {
    assert.throws(() => loadConfig(file), /not loopback/);
  });
  await withConfig({ provider: { kind: 'ollama', baseUrl: 'http://example.com:11434', model: 'm', allowNonLocalProvider: true } }, (file) => {
    const loaded = loadConfig(file);
    assert.equal(loaded.config.provider.allowNonLocalProvider, true);
  });
});

test('adapter headers come from a separate file and never from the config body', async () => {
  await withConfig(
    { adapters: { mock: { enabled: true }, http: { enabled: false, baseUrl: '', bindings: {}, headersFile: 'config/http-headers.local.json' } } },
    async (file, dir) => {
      const headersPath = join(dir, 'config', 'http-headers.local.json');
      await writeFile(headersPath, JSON.stringify({ 'x-tenant': 'acme' }), 'utf8');
      const loaded = loadConfig(file);
      assert.deepEqual(loaded.httpHeaders, { 'x-tenant': 'acme' });
    }
  );
  await withConfig(
    { adapters: { mock: { enabled: true }, http: { enabled: false, baseUrl: '', bindings: {}, headersFile: 'config/does-not-exist.json' } } },
    (file) => {
      assert.throws(() => loadConfig(file), /cannot read adapters\.http\.headersFile/);
    }
  );
});

test('an empty exposure.domains list is a supported configuration (no domain filter, still bounded)', async () => {
  await withConfig({ exposure: { maxCapabilities: 12, domains: [] } }, (file) => {
    const loaded = loadConfig(file);
    assert.deepEqual(loaded.config.exposure.domains, [], 'the domain filter can be deliberately disabled');
    assert.equal(loaded.config.exposure.maxCapabilities, 12, 'the capability cap still bounds the active surface');
  });
});

test('documented defaults are conservative and applied only where a key is absent', async () => {
  assert.equal(CONFIG_DEFAULTS.adapters.http.enabled, false);
  assert.equal(CONFIG_DEFAULTS.provider.allowNonLocalProvider, false);
  assert.equal(CONFIG_DEFAULTS.evidence.includeContextText, false);
  await withConfig({}, (/** @type {string} */ file) => {
    const loaded = loadConfig(file);
    assert.equal(loaded.config.provider.timeoutMs, CONFIG_DEFAULTS.provider.timeoutMs);
    assert.equal(loaded.config.adapters.http.enabled, false);
  });
});
