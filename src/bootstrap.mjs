/**
 * Composition root: turns configuration and the synthetic domain into a working harness.
 *
 * All build-time gates live here, so that a misconfigured capability fails at startup rather
 * than at the moment an operator is waiting for a financial operation
 * (docs/ARCHITECTURE.md I-10):
 *   - configuration is validated and its hash recorded;
 *   - the registry is sealed, so capability definitions cannot change while running;
 *   - every capability's verifier must be registered;
 *   - every capability's prerequisite checks must be registered;
 *   - the evidence journal is initialised before anything can execute.
 *
 * @module bootstrap
 */

import { ConfigError, CODES } from './core/errors.mjs';
import { loadConfig } from './core/config.mjs';
import { createRegistry } from './registry/registry.mjs';
import { createVerifierRegistry } from './evidence/verifier.mjs';
import { createJournal } from './evidence/journal.mjs';
import { createAuthority } from './policy/authority.mjs';
import { createConfirmations } from './policy/confirmations.mjs';
import { createPolicyEngine } from './policy/policy-engine.mjs';
import { createMockAccountingAdapter } from './adapters/mock-accounting-adapter.mjs';
import { createHttpAdapter } from './adapters/generic-http-adapter.mjs';
import { createProvider } from './models/provider.mjs';
import { createSyntheticAccountingStore } from './domain/synthetic-accounting/store.mjs';
import { syntheticAccountingCapabilities } from './domain/synthetic-accounting/capabilities.mjs';
import { registerSyntheticAccountingVerifiers } from './domain/synthetic-accounting/verifiers.mjs';
import { loadSop } from './models/prompt.mjs';
import { createHarness } from './harness.mjs';
import { makeId, systemClock } from './core/util.mjs';
import { resolve } from 'node:path';

/**
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {string} [options.providerKind]     Override the configured provider kind (used by tests and the CLI).
 * @param {Array<{ prompt: string, response: string }>} [options.script]  Fixture responses for the scripted provider.
 * @param {import('./core/util.mjs').Clock} [options.clock]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.sessionId]
 * @param {boolean} [options.includeContextText]
 * @param {string} [options.evidenceDir]      Override the evidence directory (used by tests).
 * @param {Record<string, unknown>[]} [options.extraCapabilities]  Additional registry entries (benchmark arms, tests).
 * @param {Record<string, Record<string, unknown>>} [options.capabilityOverrides]  Trusted overrides applied to pack definitions before sealing (used to test revocation and version drift).
 * @param {((config: any) => void)} [options.mutateConfig]          Test/benchmark-only configuration override.
 * @param {any} [options.mockAdapter]                               Adapter injection point (tests prove that a lying adapter cannot produce a verified result).
 * @param {'full'|'minimal'} [options.promptMode]                   Live-experiment control: 'minimal' omits contract/SOP guidance (Arm C). Authority is unaffected.
 * @param {'none'|'accountants-way'} [options.doctrine]             Inject the compact accounting doctrine (The Accountant's Way). Model-facing only; authority is unaffected.
 * @param {any} [options.provider]                                  Provider injection: lets a live benchmark reuse one spawned engine across many harnesses.
 * @param {boolean} [options.includeDefaultPack]                     Set false to register only the supplied capability pack (scale simulation).
 * @param {Record<string, (input: any) => { checks: Array<{ check: string, ok: boolean, detail?: string }> }>} [options.extraVerifiers]  Additional verifiers for injected capabilities (tests, benchmark arms).
 */
export async function createHarnessFromConfig(options = {}) {
  const configPath = options.configPath ?? resolve(process.cwd(), 'config/harness.config.json');
  const loaded = loadConfig(configPath);
  const config = loaded.config;
  if (options.providerKind) config.provider.kind = options.providerKind;
  if (options.mutateConfig) options.mutateConfig(config);

  const clock = options.clock ?? systemClock;
  const sessionId = options.sessionId ?? makeId('sess');

  // ---- domain + registry ----------------------------------------------------
  const store = createSyntheticAccountingStore();
  const registry = createRegistry();
  const overrides = options.capabilityOverrides ?? {};
  if (options.includeDefaultPack !== false) {
    for (const definition of syntheticAccountingCapabilities()) {
      const override = overrides[String(definition.id)];
      registry.register(override ? { ...definition, ...override } : definition);
    }
  }
  for (const definition of options.extraCapabilities ?? []) registry.register(definition);
  registry.seal();

  // ---- verifiers ------------------------------------------------------------
  const verifiers = createVerifierRegistry();
  registerSyntheticAccountingVerifiers(verifiers, store);
  for (const [verifierId, fn] of Object.entries(options.extraVerifiers ?? {})) {
    verifiers.register(verifierId, /** @type {any} */ (fn));
  }
  for (const capability of registry.list()) {
    if (!verifiers.has(capability.verifier)) {
      throw new ConfigError(
        CODES.CONFIG_INVALID,
        `capability "${capability.id}" declares verifier "${capability.verifier}" which is not registered`
      );
    }
  }

  // ---- prerequisite checks --------------------------------------------------
  /** @type {Record<string, (capabilityId: string) => { available: boolean, detail?: string }>} */
  const prerequisiteChecks = {
    'invoice.has_draft': () => ({
      available: store.hasDraftInvoice(),
      detail: 'no draft invoice exists'
    })
  };
  const prerequisite = (/** @type {string} */ checkId, /** @type {string} */ capabilityId) => {
    const fn = prerequisiteChecks[checkId];
    if (!fn) {
      throw new ConfigError(CODES.CONFIG_INVALID, `capability "${capabilityId}" requires unregistered prerequisite check "${checkId}"`);
    }
    return fn(capabilityId);
  };
  for (const capability of registry.list()) {
    for (const checkId of capability.prerequisites.checks) {
      prerequisite(checkId, capability.id);
    }
  }

  // ---- adapters -------------------------------------------------------------
  const mockAdapter = options.mockAdapter ?? createMockAccountingAdapter({ store, enabled: config.adapters.mock.enabled });
  const httpAdapter = createHttpAdapter({
    config: /** @type {any} */ (config.adapters.http),
    headers: loaded.httpHeaders,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });

  // ---- evidence -------------------------------------------------------------
  const journal = createJournal({
    dir: options.evidenceDir ?? loaded.evidenceDir,
    sessionId,
    clock
  });
  await journal.init();
  await journal.append('SESSION_CLOSED', {
    data: {
      phase: 'session-start',
      configHash: loaded.configHash,
      registryHash: registry.hash(),
      registrySize: registry.size(),
      identity: config.identity,
      disabledCapabilities: registry.list().filter((c) => !c.enabled).map((c) => c.id),
      provider: { kind: config.provider.kind, model: config.provider.model, baseUrl: config.provider.baseUrl },
      adapters: { mock: config.adapters.mock.enabled, http: config.adapters.http.enabled },
      riskAllowlist: config.policy.riskAllowlist,
      requireConfirmationFor: config.policy.requireConfirmationFor,
      grantedPermissions: config.policy.grantedPermissions,
      exposure: config.exposure
    }
  });

  // ---- authority, confirmations, policy -------------------------------------
  const authority = createAuthority({ clock, ttlMs: config.authority.permitTtlSeconds * 1000 });
  const confirmations = createConfirmations({ clock, ttlMs: config.confirmation.ttlSeconds * 1000 });
  const policy = createPolicyEngine({ config, registry, adapters: { mock: mockAdapter, http: httpAdapter } });

  // ---- provider + SOP -------------------------------------------------------
  const provider = options.provider ?? createProvider(config.provider, {
    ...(options.script ? { script: options.script } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  const sop = loadSop(
    resolve(loaded.rootDir, 'prompts/accounting-resident.sop.md'),
    resolve(loaded.rootDir, 'prompts/resident-base-contract.md'),
    ...(options.doctrine === 'accountants-way' ? [resolve(loaded.rootDir, 'prompts/accountants-way.compact.md')] : [])
  );

  const harness = createHarness({
    config,
    configHash: loaded.configHash,
    registry,
    provider,
    journal,
    authority,
    confirmations,
    policy,
    adapters: { mock: mockAdapter, http: httpAdapter },
    verifiers,
    prerequisite,
    sop,
    sessionId,
    clock,
    includeContextText: options.includeContextText ?? config.evidence.includeContextText === true,
    ...(options.promptMode ? { promptMode: options.promptMode } : {})
  });

  return {
    harness,
    config,
    clock,
    configHash: loaded.configHash,
    registry,
    store,
    journal,
    authority,
    confirmations,
    policy,
    adapters: { mock: mockAdapter, http: httpAdapter },
    verifiers,
    provider,
    sop,
    sessionId,
    evidenceDir: options.evidenceDir ?? loaded.evidenceDir,
    prerequisite
  };
}
