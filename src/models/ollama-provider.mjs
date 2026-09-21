/**
 * Ollama provider — a thin, defensive HTTP adapter over the documented local API.
 *
 * Design notes grounded in docs/research/RESEARCH_LEDGER.md §1:
 *  - Native `/api/chat` (R-14) because it exposes `num_ctx` and `keep_alive`.
 *  - `stream: false` explicitly (R-04, R-10): v0.1 does not implement NDJSON accumulation.
 *  - `format` carries the envelope schema (R-01); the schema is ALSO restated in the prompt
 *    (R-03) and the output is validated by the harness regardless (R-15).
 *  - `tools` is never sent (R-06, R-07): no `tool_choice` support, multiple calls possible,
 *    no published argument-validity guarantee.
 *  - The API is unauthenticated and localhost-bound (R-12), so no credential is ever sent,
 *    and a non-loopback host is refused unless the operator explicitly opted in.
 *  - Typed error mapping for 404/429/5xx and unreachable transports (R-08). No silent retry.
 *
 * @module models/ollama-provider
 */

import { ProviderError, CODES, messageOf } from '../core/errors.mjs';
import { assertLoopback } from '../core/config.mjs';

/**
 * @typedef {import('./provider.mjs').Provider} Provider
 */

/**
 * @param {{ baseUrl: string, model: string, timeoutMs?: number, numCtx?: number, keepAlive?: string, seed?: number, temperature?: number, allowNonLocalProvider?: boolean, fetchImpl?: typeof fetch }} options
 * @returns {Provider}
 */
export function createOllamaProvider(options) {
  const {
    baseUrl,
    model,
    timeoutMs = 30000,
    numCtx = 8192,
    keepAlive = '5m',
    seed = 7,
    temperature = 0,
    allowNonLocalProvider = false
  } = options;

  assertLoopback(baseUrl, allowNonLocalProvider, 'provider.baseUrl');

  if (!model || model === 'REPLACE_WITH_YOUR_MODEL') {
    throw new ProviderError(
      CODES.PROVIDER_NOT_CONFIGURED,
      'provider.model is not configured. Set a model name in config/harness.config.json (the harness does not choose a model family for you).'
    );
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    kind: 'ollama',
    model,

    /**
     * @param {import('./provider.mjs').ProviderRequest} request
     * @returns {Promise<import('./provider.mjs').ProviderResult>}
     */
    async complete(request) {
      const deadlineMs = request.timeoutMs ?? timeoutMs;
      const body = {
        model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage }
        ],
        stream: false,
        format: request.formatSchema,
        keep_alive: keepAlive,
        options: { temperature, seed, num_ctx: numCtx }
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      /** @type {Response} */
      let response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'manual'
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ProviderError(CODES.PROVIDER_TIMEOUT, `model runtime did not answer within ${deadlineMs} ms`, {
            reason: 'timeout'
          });
        }
        const code = transportCodeOf(err);
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
          throw new ProviderError(CODES.PROVIDER_UNAVAILABLE, `model runtime unreachable at ${baseUrl} (${code})`, { reason: code });
        }
        throw new ProviderError(CODES.PROVIDER_UNAVAILABLE, `model runtime request failed: ${messageOf(err)}`);
      } finally {
        clearTimeout(timer);
      }

      const raw = await safeText(response);
      if (!response.ok) {
        const detail = extractError(raw);
        if (response.status === 404) {
          throw new ProviderError(CODES.PROVIDER_MODEL_MISSING, `model "${model}" is not available on the runtime: ${detail}`, {
            reason: detail
          });
        }
        throw new ProviderError(CODES.PROVIDER_HTTP_ERROR, `model runtime returned HTTP ${response.status}: ${detail}`, {
          reason: detail
        });
      }

      /** @type {any} */
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ProviderError(CODES.PROVIDER_BAD_RESPONSE, 'model runtime returned a non-JSON response body');
      }
      if (data && typeof data === 'object' && typeof data.error === 'string' && data.error.length > 0) {
        throw new ProviderError(CODES.PROVIDER_BAD_RESPONSE, `model runtime reported an error: ${data.error}`);
      }
      const content = data?.message?.content;
      if (typeof content !== 'string') {
        throw new ProviderError(CODES.PROVIDER_BAD_RESPONSE, 'model runtime response did not contain message.content');
      }

      return {
        text: content,
        meta: {
          provider: 'ollama',
          model,
          doneReason: typeof data?.done_reason === 'string' ? data.done_reason : undefined,
          evalCount: typeof data?.eval_count === 'number' ? data.eval_count : undefined,
          totalDurationMs: typeof data?.total_duration === 'number' ? Math.round(data.total_duration / 1e6) : undefined,
          loadDurationMs: typeof data?.load_duration === 'number' ? Math.round(data.load_duration / 1e6) : undefined,
          serverVersion: null,
          seed,
          temperature
        }
      };
    },

    /** Optional: record the runtime version in benchmark metadata (R-14). */
    async getVersion() {
      try {
        const res = await doFetch(`${baseUrl.replace(/\/+$/, '')}/api/version`, { method: 'GET', redirect: 'manual' });
        if (!res.ok) return null;
        const parsed = JSON.parse(await safeText(res));
        return typeof parsed?.version === 'string' ? parsed.version : null;
      } catch {
        return null;
      }
    }
  };
}

/**
 * Node's fetch reports the transport failure reason inside `err.cause`; checking only
 * `err.code` would classify every refused connection as a generic failure.
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

/**
 * @param {string} raw
 * @returns {string}
 */
function extractError(raw) {
  if (!raw) return 'no body';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch {
    /* fall through to a bounded excerpt */
  }
  return raw.slice(0, 200);
}
