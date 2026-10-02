/**
 * Ollama provider — a thin, defensive HTTP adapter over the documented local API.
 *
 * Design notes grounded in docs/research/RESEARCH_LEDGER.md §1:
 *  - Native `/api/chat` (R-14) because it exposes `num_ctx` and `keep_alive`.
 *  - `stream: false` explicitly (R-04, R-10): v0.1 does not implement NDJSON accumulation.
 *  - `format` carries the envelope schema (R-01); the schema is ALSO restated in the prompt
 *    (R-03) and the output is validated by the harness regardless (R-15).
 *  - Two call protocols, chosen by `toolCallMode`:
 *      "json"   — the envelope schema travels in `format` (R-01); the model is asked to emit one
 *                 JSON object. Default; unchanged behaviour.
 *      "native" — the callable surface travels in `tools` and the runtime maps the model's native
 *                 tool call back to `message.tool_calls`; the provider converts the FIRST call into
 *                 the same envelope JSON so the harness keeps ONE parsing/authority path. Required
 *                 for models that speak native tool calls instead of the envelope instruction
 *                 (`toolCallMode "native"` without `request.tools` fails closed).
 *    In both modes the provider returns TEXT; parsing and authority remain the harness's.
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
 * @param {{ baseUrl: string, model: string, timeoutMs?: number, numCtx?: number, keepAlive?: string, seed?: number, temperature?: number, allowNonLocalProvider?: boolean, toolCallMode?: string, fetchImpl?: typeof fetch }} options
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
  const toolCallMode = options.toolCallMode ?? 'json';
  if (toolCallMode !== 'json' && toolCallMode !== 'native') {
    throw new ProviderError(
      CODES.PROVIDER_NOT_CONFIGURED,
      `provider.toolCallMode must be "json" or "native" (got ${JSON.stringify(toolCallMode)}).`
    );
  }

  return {
    kind: 'ollama',
    model,

    /**
     * @param {import('./provider.mjs').ProviderRequest} request
     * @returns {Promise<import('./provider.mjs').ProviderResult>}
     */
    async complete(request) {
      const deadlineMs = request.timeoutMs ?? timeoutMs;
      const tools = Array.isArray(request.tools) ? request.tools : [];
      if (toolCallMode === 'native' && tools.length === 0) {
        throw new ProviderError(
          CODES.PROVIDER_NOT_CONFIGURED,
          'toolCallMode "native" requires request.tools: the tools API carries the call contract, and without it the model has no callable surface.'
        );
      }
      const body = {
        model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage }
        ],
        stream: false,
        keep_alive: keepAlive,
        options: { temperature, seed, num_ctx: numCtx },
        ...(toolCallMode === 'native' ? { tools } : { format: request.formatSchema })
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

      const toolCalls = Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : [];
      if (toolCallMode === 'native' && toolCalls.length > 1) {
        throw new ProviderError(
          CODES.PROVIDER_BAD_RESPONSE,
          `native response contained ${toolCalls.length} tool calls; the harness contract is exactly one ActionProposal per turn`,
          { toolCalls: toolCalls.length }
        );
      }
      let text = content;
      if (toolCallMode === 'native' && toolCalls.length > 0) {
        const envelope = toolCallToEnvelope(toolCalls[0]);
        if (envelope === null) {
          throw new ProviderError(
            CODES.PROVIDER_BAD_RESPONSE,
            'native tool call could not be mapped to a proposal envelope (missing function name or unparseable arguments)'
          );
        }
        text = JSON.stringify(envelope);
      }
      const reasoning = data?.message?.reasoning_content ?? data?.message?.thinking;
      const promptEvalCount = typeof data?.prompt_eval_count === 'number' ? data.prompt_eval_count : undefined;
      const promptEvalNs = typeof data?.prompt_eval_duration === 'number' ? data.prompt_eval_duration : undefined;
      const evalCount = typeof data?.eval_count === 'number' ? data.eval_count : undefined;
      const evalNs = typeof data?.eval_duration === 'number' ? data.eval_duration : undefined;

      return {
        text,
        meta: {
          provider: 'ollama',
          model,
          toolCallMode,
          doneReason: typeof data?.done_reason === 'string' ? data.done_reason : undefined,
          evalCount,
          totalDurationMs: typeof data?.total_duration === 'number' ? Math.round(data.total_duration / 1e6) : undefined,
          loadDurationMs: typeof data?.load_duration === 'number' ? Math.round(data.load_duration / 1e6) : undefined,
          promptEvalCount,
          promptEvalMs: promptEvalNs === undefined ? undefined : Math.round(promptEvalNs / 1e6),
          evalMs: evalNs === undefined ? undefined : Math.round(evalNs / 1e6),
          promptEvalTokensPerSecond: promptEvalCount !== undefined && promptEvalNs ? roundRate(promptEvalCount, promptEvalNs) : undefined,
          evalTokensPerSecond: evalCount !== undefined && evalNs ? roundRate(evalCount, evalNs) : undefined,
          reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
          toolCalls: toolCalls.length,
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

/**
 * @param {number} count
 * @param {number} durationNs
 * @returns {number}
 */
function roundRate(count, durationNs) {
  return Math.round((count / (durationNs / 1e9)) * 100) / 100;
}

/**
 * Map ONE native tool call (the runtime's `message.tool_calls[i]`) into the same envelope the
 * harness already parses for the JSON protocol, so authority, validation, and evidence have one
 * path regardless of protocol. Models that ask or refuse through pseudo-tools use the reserved
 * names `clarification` / `unsupported`.
 *
 * @param {unknown} call
 * @returns {{ kind: 'proposal', capability: string, arguments: Record<string, unknown>, reasoningSummary: string }
 *   | { kind: 'clarification', question: string, reasoningSummary: string }
 *   | { kind: 'unsupported', reason: string, reasoningSummary: string }
 *   | null}
 */
export function toolCallToEnvelope(call) {
  const fn = call !== null && typeof call === 'object' ? /** @type {any} */ (call).function : null;
  if (!fn || typeof fn.name !== 'string' || fn.name.trim().length === 0) return null;
  let args = fn.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  // The runtime contract declares `arguments` as an object. Malformed shapes (missing, null, array,
  // primitive, or a JSON string that does not parse to an object) are REJECTED rather than
  // normalized into a possibly-valid proposal.
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return null;
  if (fn.name === 'clarification') {
    const question = typeof args.question === 'string' && args.question.trim().length > 0 ? args.question : 'Could you clarify?';
    return { kind: 'clarification', question, reasoningSummary: 'native tool call' };
  }
  if (fn.name === 'unsupported') {
    const reason = typeof args.reason === 'string' && args.reason.trim().length > 0 ? args.reason : 'Not supported.';
    return { kind: 'unsupported', reason, reasoningSummary: 'native tool call' };
  }
  return { kind: 'proposal', capability: fn.name, arguments: args, reasoningSummary: 'native tool call' };
}

/**
 * Build the runtime's `tools` payload from plain definitions ({ name, description, parameters }),
 * keeping the provider free of any knowledge about capabilities or the domain.
 *
 * @param {Array<{ name: string, description?: string, parameters?: Record<string, unknown> }>} definitions
 * @returns {Array<Record<string, unknown>>}
 */
export function toolsFromDefinitions(definitions) {
  return (Array.isArray(definitions) ? definitions : []).map((definition) => ({
    type: 'function',
    function: {
      name: String(definition.name),
      description: String(definition.description ?? '').slice(0, 512),
      parameters:
        definition.parameters !== null && typeof definition.parameters === 'object'
          ? definition.parameters
          : { type: 'object', properties: {} }
    }
  }));
}
