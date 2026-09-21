/**
 * Generic HTTP adapter — the integration seam, disabled unless explicitly configured.
 *
 * Confused-deputy control (research R-30): the model chooses a capability; the METHOD, PATH,
 * and HOST come from trusted configuration. There is no capability schema in this repository
 * that accepts a URL, a method, a host, or a header, so no model output can influence them.
 * Path placeholders are substituted only from arguments that already passed their schema, and
 * each substituted value is percent-encoded.
 *
 * Other deliberate restrictions (threats T-09/T-10, FAILURE_MATRIX F-20/F-21):
 *  - disabled by default, and refused at policy time when disabled;
 *  - a binding must exist for the capability or the request is denied, never defaulted;
 *  - no redirect following (`redirect: 'manual'`), so a redirect cannot re-target the call;
 *  - request timeout, bounded response size handling, and typed failures;
 *  - headers come from an optional gitignored file and are never journaled;
 *  - a response that does not satisfy the binding's expectation is a failure, not a success
 *    (ambiguous-success handling, DESIGN_CRITIC H-8).
 *
 * @module adapters/generic-http-adapter
 */

import { AdapterError, CODES, messageOf } from '../core/errors.mjs';

/**
 * @typedef {object} HttpBinding
 * @property {string} method   Validated against the allowed set when the configuration is loaded.
 * @property {string} path
 * @property {number} [expectStatus]
 * @property {string[]} [requiredResponseFields]
 */

/**
 * @param {{ config: { enabled: boolean, baseUrl: string, timeoutMs: number, bindings: Record<string, HttpBinding> }, headers?: Record<string, string>|null, fetchImpl?: typeof fetch }} deps
 */
export function createHttpAdapter(deps) {
  const { config } = deps;
  const headers = deps.headers ?? null;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = config.enabled ? new URL(config.baseUrl) : null;

  return {
    kind: 'http',
    enabled: config.enabled,
    baseUrl: config.baseUrl,

    /**
     * @param {string} capabilityId
     * @returns {HttpBinding|null}
     */
    resolveBinding(capabilityId) {
      if (!config.enabled) return null;
      const binding = config.bindings[capabilityId];
      return binding ?? null;
    },

    /** @returns {string[]} */
    boundCapabilities() {
      return Object.keys(config.bindings);
    },

    /**
     * Deliberately a loose outcome shape rather than a discriminated union: callers must check
     * `ok` at runtime anyway, and the loose shape keeps the call sites honest about that without
     * forcing narrowing ceremony on every assertion.
     * @param {{ capability: import('../registry/capability.mjs').Capability, bindingId: string, arguments: Record<string, unknown> }} input
     * @returns {Promise<{ ok: boolean, data?: Record<string, unknown>, code?: string, detail?: string, commitState?: 'NOT_SENT'|'UNKNOWN' }>}
     */
    async execute(input) {
      if (!config.enabled || base === null) {
        return { ok: false, code: CODES.ADAPTER_DISABLED, detail: 'http adapter is disabled by configuration', commitState: 'NOT_SENT' };
      }
      const binding = config.bindings[input.capability.id];
      if (!binding) {
        return {
          ok: false,
          code: CODES.ADAPTER_BINDING_MISSING,
          detail: `no trusted binding for ${input.capability.id}`,
          commitState: 'NOT_SENT'
        };
      }

      let target;
      let remaining;
      try {
        const substituted = substitutePath(binding.path, input.arguments);
        target = new URL(substituted.path, base);
        if (target.origin !== base.origin) {
          return {
            ok: false,
            code: CODES.ADAPTER_INPUT_INVALID,
            detail: `binding for ${input.capability.id} escapes the configured host`,
            commitState: 'NOT_SENT'
          };
        }
        remaining = substituted.remaining;
      } catch (err) {
        return { ok: false, code: CODES.ADAPTER_INPUT_INVALID, detail: messageOf(err), commitState: 'NOT_SENT' };
      }

      const method = binding.method;
      /** @type {Record<string, string>} */
      const requestHeaders = { accept: 'application/json' };
      let body;
      if (method === 'GET' || method === 'DELETE') {
        for (const [key, value] of Object.entries(remaining)) {
          target.searchParams.set(key, stringifyParam(value));
        }
      } else {
        requestHeaders['content-type'] = 'application/json';
        body = JSON.stringify(remaining);
      }
      if (headers) {
        for (const [key, value] of Object.entries(headers)) requestHeaders[key] = value;
      }

      const controller = new AbortController();
      const timeoutMs = config.timeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      /** @type {Response} */
      let response;
      try {
        response = await doFetch(target.toString(), {
          method,
          headers: requestHeaders,
          body,
          signal: controller.signal,
          redirect: 'manual'
        });
      } catch (err) {
        // Commit certainty is a property of the transport event AND the method. A timed-out or
        // reset non-idempotent request may have been applied by the application; that is
        // COMMIT_UNKNOWN and must never be retried blindly (directive: ambiguous commit).
        const ambiguous = isNonIdempotent(method);
        if (err instanceof Error && err.name === 'AbortError') {
          return {
            ok: false,
            code: CODES.ADAPTER_TIMEOUT,
            detail: `request to the configured endpoint timed out after ${timeoutMs} ms`,
            commitState: ambiguous ? 'UNKNOWN' : 'NOT_SENT'
          };
        }
        const transportCode = transportCodeOf(err);
        if (transportCode === 'ECONNREFUSED' || transportCode === 'ENOTFOUND' || transportCode === 'EHOSTUNREACH' || transportCode === 'ERR_INVALID_URL') {
          return {
            ok: false,
            code: CODES.ADAPTER_ERROR,
            detail: `endpoint unreachable (${transportCode})`,
            commitState: 'NOT_SENT'
          };
        }
        return {
          ok: false,
          code: CODES.ADAPTER_ERROR,
          detail: `request failed: ${messageOf(err)}`,
          commitState: ambiguous ? 'UNKNOWN' : 'NOT_SENT'
        };
      } finally {
        clearTimeout(timer);
      }

      const expected = binding.expectStatus ?? 200;
      if (response.status !== expected) {
        // 4xx is a deterministic refusal (the application declined). 5xx on a non-idempotent
        // request means the application may have failed midway: ambiguous.
        const deterministic = response.status < 500 || method === 'GET';
        return {
          ok: false,
          code: CODES.ADAPTER_HTTP_STATUS,
          detail: `expected HTTP ${expected} from the configured binding, got ${response.status}`,
          commitState: deterministic ? 'NOT_SENT' : 'UNKNOWN'
        };
      }

      /** @type {unknown} */
      let parsed = null;
      const text = await safeText(response);
      if (text.trim().length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          return { ok: false, code: CODES.ADAPTER_BAD_RESPONSE, detail: 'configured endpoint returned a non-JSON body', commitState: 'UNKNOWN' };
        }
      }

      const requiredFields = binding.requiredResponseFields ?? [];
      if (requiredFields.length > 0) {
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, code: CODES.ADAPTER_UNEXPECTED_RESPONSE, detail: 'response body is not an object', commitState: 'UNKNOWN' };
        }
        const missing = requiredFields.filter((field) => !(field in /** @type {Record<string, unknown>} */ (parsed)));
        if (missing.length > 0) {
          return {
            ok: false,
            code: CODES.ADAPTER_UNEXPECTED_RESPONSE,
            detail: `response is missing required field(s): ${missing.join(', ')}`,
            commitState: 'UNKNOWN'
          };
        }
      }

      return {
        ok: true,
        data: {
          status: response.status,
          body: parsed,
          binding: { method, path: binding.path }
        }
      };
    }
  };
}

/**
 * Substitute `{name}` placeholders from validated arguments. Unknown placeholders are an
 * error, not an empty string: a half-built URL must never be sent.
 * @param {string} path
 * @param {Record<string, unknown>} args
 * @returns {{ path: string, remaining: Record<string, unknown> }}
 */
function substitutePath(path, args) {
  if (path.startsWith('//')) {
    throw new AdapterError(CODES.ADAPTER_INPUT_INVALID, 'binding path must not be protocol-relative');
  }
  const used = new Set();
  const replaced = path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => {
    if (!(name in args)) {
      throw new AdapterError(CODES.ADAPTER_INPUT_INVALID, `binding path requires argument "${name}" which was not supplied`);
    }
    used.add(name);
    return encodeURIComponent(stringifyParam(args[name]));
  });
  /** @type {Record<string, unknown>} */
  const remaining = {};
  for (const [key, value] of Object.entries(args)) {
    if (!used.has(key)) remaining[key] = value;
  }
  return { path: replaced, remaining };
}

/**
 * The transport error code. Node's fetch (undici) reports the real cause inside `err.cause`,
 * so a check of `err.code` alone silently misclassifies connection refusals as ambiguous.
 * @param {unknown} err
 * @returns {string|undefined}
 */
function transportCodeOf(err) {
  if (err === null || typeof err !== 'object') return undefined;
  const direct = /** @type {{ code?: string }} */ (err).code;
  if (typeof direct === 'string') return direct;
  const cause = /** @type {{ cause?: { code?: string } }} */ (err).cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
}

/**
 * @param {string} method
 * @returns {boolean}
 */
function isNonIdempotent(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyParam(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
