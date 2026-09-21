/**
 * Trusted configuration: loading, strict validation, and the sovereignty checks.
 *
 * Configuration is a trust boundary (docs/matrices/THREAT_MATRIX.md T-18): whatever it says
 * about permissions, risk and endpoints is authority. It is therefore validated exhaustively
 * at startup, unknown keys are rejected, and no default silently substitutes for a missing
 * security-relevant value.
 *
 * @module core/config
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ConfigError, CODES } from './errors.mjs';
import { validate } from './schema.mjs';
import { sha256Hex, canonicalJson } from './canonical.mjs';
import { RISK } from '../policy/risk.mjs';

/**
 * @typedef {object} HarnessConfig
 * @property {{ actorId: string, workspaceId: string }} identity
 * @property {{ kind: string, baseUrl: string, model: string, timeoutMs: number, numCtx: number, keepAlive: string, seed: number, temperature: number, allowNonLocalProvider: boolean }} provider
 * @property {{ riskAllowlist: string[], requireConfirmationFor: string[], grantedPermissions: string[] }} policy
 * @property {{ ttlSeconds: number }} confirmation
 * @property {{ permitTtlSeconds: number }} authority
 * @property {{ maxCapabilities: number, domains: string[] }} exposure
 * @property {{ mock: { enabled: boolean }, http: { enabled: boolean, baseUrl: string, bindings: Record<string, { method: string, path: string, expectStatus?: number, requiredResponseFields?: string[] }>, headersFile: string|null, timeoutMs: number } }} adapters
 * @property {{ dir: string, includeContextText?: boolean }} evidence
 */

const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'policy', 'confirmation', 'authority', 'exposure', 'adapters', 'evidence'],
  properties: {
    identity: {
      type: 'object',
      additionalProperties: false,
      required: ['actorId', 'workspaceId'],
      properties: {
        actorId: { type: 'string', minLength: 1, maxLength: 64 },
        workspaceId: { type: 'string', minLength: 1, maxLength: 64 }
      }
    },
    provider: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'baseUrl', 'model'],
      properties: {
        kind: { type: 'string', enum: ['ollama', 'scripted'] },
        baseUrl: { type: 'string', minLength: 8, maxLength: 200 },
        model: { type: 'string', minLength: 1, maxLength: 120 },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 600000 },
        numCtx: { type: 'integer', minimum: 512, maximum: 262144 },
        keepAlive: { type: 'string', minLength: 1, maxLength: 32 },
        seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        allowNonLocalProvider: { type: 'boolean' }
      }
    },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: ['riskAllowlist', 'requireConfirmationFor', 'grantedPermissions'],
      properties: {
        riskAllowlist: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 4 },
        requireConfirmationFor: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 4 },
        grantedPermissions: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, minItems: 0, maxItems: 64 }
      }
    },
    confirmation: {
      type: 'object',
      additionalProperties: false,
      required: ['ttlSeconds'],
      properties: { ttlSeconds: { type: 'integer', minimum: 5, maximum: 3600 } }
    },
    authority: {
      type: 'object',
      additionalProperties: false,
      required: ['permitTtlSeconds'],
      properties: { permitTtlSeconds: { type: 'integer', minimum: 1, maximum: 3600 } }
    },
    exposure: {
      type: 'object',
      additionalProperties: false,
      required: ['maxCapabilities', 'domains'],
      properties: {
        maxCapabilities: { type: 'integer', minimum: 1, maximum: 32 },
        domains: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, minItems: 1, maxItems: 32 }
      }
    },
    adapters: {
      type: 'object',
      additionalProperties: false,
      required: ['mock', 'http'],
      properties: {
        mock: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } }
        },
        http: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled'],
          properties: {
            enabled: { type: 'boolean' },
            baseUrl: { type: 'string', minLength: 0, maxLength: 200 },
            bindings: { type: 'object' },
            headersFile: { type: ['string', 'null'], minLength: 1, maxLength: 300 },
            timeoutMs: { type: 'integer', minimum: 100, maximum: 120000 }
          }
        }
      }
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['dir'],
      properties: {
        dir: { type: 'string', minLength: 1, maxLength: 300 },
        includeContextText: { type: 'boolean' }
      }
    }
  }
};

/** Documented defaults for optional keys. Security-relevant keys have conservative defaults. */
export const CONFIG_DEFAULTS = Object.freeze({
  identity: { actorId: 'operator-local', workspaceId: 'synthetic-default' },
  provider: { timeoutMs: 30000, numCtx: 8192, keepAlive: '5m', seed: 7, temperature: 0, allowNonLocalProvider: false },
  adapters: { mock: { enabled: true }, http: { enabled: false, baseUrl: '', bindings: {}, headersFile: null, timeoutMs: 10000 } },
  evidence: { includeContextText: false }
});

export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * @typedef {object} LoadedConfig
 * @property {HarnessConfig} config   Effective config (as authored, with documented defaults applied).
 * @property {string} configHash      sha256 of the canonical effective config.
 * @property {string} rootDir         Repository root inferred from the config file location.
 * @property {string} evidenceDir     Absolute evidence directory.
 * @property {Record<string, string>|null} httpHeaders  Loaded adapter headers (never journaled).
 */

/**
 * Load and validate the harness configuration.
 * @param {string} configPath
 * @returns {LoadedConfig}
 */
export function loadConfig(configPath) {
  const absolute = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new ConfigError(CODES.CONFIG_INVALID, `cannot read config ${absolute}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const issues = validate(raw, CONFIG_SCHEMA);
  if (issues.length > 0) {
    const rendered = issues.map((i) => `${i.path} ${i.message}`).join('; ');
    throw new ConfigError(CODES.CONFIG_INVALID, `invalid config: ${rendered}`, { reason: rendered });
  }

  const authored = /** @type {HarnessConfig} */ (raw);
  const config = applyDefaults(authored);
  enforceSemantics(config);

  const rootDir = resolve(dirname(absolute), '..');
  const evidenceDir = isAbsolute(config.evidence.dir) ? config.evidence.dir : resolve(rootDir, config.evidence.dir);
  const httpHeaders = loadHeaders(config, rootDir);

  return { config, configHash: sha256Hex(canonicalJson(config)), rootDir, evidenceDir, httpHeaders };
}

/**
 * @param {HarnessConfig} authored
 * @returns {HarnessConfig}
 */
function applyDefaults(authored) {
  return {
    identity: { ...CONFIG_DEFAULTS.identity, ...(authored.identity ?? {}) },
    provider: { ...CONFIG_DEFAULTS.provider, ...authored.provider },
    policy: authored.policy,
    confirmation: authored.confirmation,
    authority: authored.authority,
    exposure: authored.exposure,
    adapters: {
      mock: { ...CONFIG_DEFAULTS.adapters.mock, ...authored.adapters.mock },
      http: { ...CONFIG_DEFAULTS.adapters.http, ...authored.adapters.http }
    },
    evidence: { ...CONFIG_DEFAULTS.evidence, ...authored.evidence }
  };
}

/**
 * Semantic checks the schema cannot express. Every one of these refuses to start rather
 * than degrading.
 * @param {HarnessConfig} config
 */
function enforceSemantics(config) {
  const risks = Object.values(RISK);
  const riskClasses = /** @type {string[]} */ (risks);
  for (const value of config.policy.riskAllowlist) {
    if (!riskClasses.includes(value)) {
      throw new ConfigError(CODES.CONFIG_INVALID, `policy.riskAllowlist contains unknown risk class "${value}"`);
    }
  }
  for (const value of config.policy.requireConfirmationFor) {
    if (!riskClasses.includes(value)) {
      throw new ConfigError(CODES.CONFIG_INVALID, `policy.requireConfirmationFor contains unknown risk class "${value}"`);
    }
  }
  if (!config.policy.requireConfirmationFor.includes(RISK.FINANCIAL)) {
    throw new ConfigError(
      CODES.CONFIG_INVALID,
      'policy.requireConfirmationFor must include FINANCIAL: the harness will not run with unconfirmed financial authority'
    );
  }
  if (new Set(config.policy.grantedPermissions).size !== config.policy.grantedPermissions.length) {
    throw new ConfigError(CODES.CONFIG_INVALID, 'policy.grantedPermissions contains duplicates');
  }

  if (config.provider.kind === 'ollama') {
    assertLoopback(config.provider.baseUrl, config.provider.allowNonLocalProvider, 'provider.baseUrl');
  }

  if (config.adapters.http.enabled) {
    if (!config.adapters.http.baseUrl) {
      throw new ConfigError(CODES.CONFIG_INVALID, 'adapters.http.enabled is true but adapters.http.baseUrl is empty');
    }
    assertLoopback(config.adapters.http.baseUrl, false, 'adapters.http.baseUrl');
    for (const [capabilityId, binding] of Object.entries(config.adapters.http.bindings)) {
      if (!/^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$/.test(capabilityId)) {
        throw new ConfigError(CODES.CONFIG_INVALID, `adapters.http.bindings key "${capabilityId}" is not a capability id`);
      }
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(binding.method)) {
        throw new ConfigError(CODES.CONFIG_INVALID, `binding ${capabilityId}: unsupported method "${binding.method}"`);
      }
      if (!binding.path || !binding.path.startsWith('/')) {
        throw new ConfigError(CODES.CONFIG_INVALID, `binding ${capabilityId}: path must start with "/"`);
      }
    }
  }
}

/**
 * The provider and the HTTP adapter are local-first. A non-loopback host is refused unless
 * the operator explicitly opts in, and the opt-in is recorded by the caller.
 * @param {string} baseUrl
 * @param {boolean} allowNonLocal
 * @param {string} label
 */
export function assertLoopback(baseUrl, allowNonLocal, label) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError(CODES.CONFIG_INVALID, `${label} is not a valid URL: ${baseUrl}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConfigError(CODES.CONFIG_INVALID, `${label} must be http(s), got ${url.protocol}`);
  }
  if (LOOPBACK_HOSTS.includes(url.hostname)) return;
  if (allowNonLocal) return;
  throw new ConfigError(
    CODES.CONFIG_INVALID,
    `${label} host "${url.hostname}" is not loopback. Set allowNonLocalProvider=true only if you intend to leave this machine.`
  );
}

/**
 * Adapter headers come from an optional gitignored file so that no secret is ever committed.
 * They are returned separately from the config and are never journaled.
 * @param {HarnessConfig} config
 * @param {string} rootDir
 * @returns {Record<string, string>|null}
 */
function loadHeaders(config, rootDir) {
  const file = config.adapters.http.headersFile;
  if (!file) return null;
  const absolute = isAbsolute(file) ? file : resolve(rootDir, file);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new ConfigError(CODES.CONFIG_INVALID, `cannot read adapters.http.headersFile ${absolute}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(CODES.CONFIG_INVALID, 'adapters.http.headersFile must contain a JSON object of string values');
  }
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (parsed))) {
    if (typeof value !== 'string') {
      throw new ConfigError(CODES.CONFIG_INVALID, `header "${key}" must be a string`);
    }
    headers[key] = value;
  }
  return headers;
}
