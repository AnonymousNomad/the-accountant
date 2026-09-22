/**
 * llama-server provider — a live local engine behind the same provider interface.
 *
 * Grounded in the verified local baseline (docs/LIVE_MODEL_VALIDATION.md):
 *   engine   E:\llama-cpp\llama-server.exe, build 9940
 *   artifact LFM2.5-230M-Q8_0.gguf (sha256 verified)
 *   contract OpenAI-compatible /v1/chat/completions on loopback
 *
 * What this module owns: spawning the engine, waiting for health, exposing the model id the
 * engine reports, requesting schema-constrained output, timing each phase, and killing the
 * process it started — and nothing else. It returns TEXT. The harness parses and validates that
 * text exactly as it does for any other provider, so there is still one ActionProposal path and
 * one execution architecture (directive §2).
 *
 * Restrictions carried over from v0.1: loopback only unless explicitly overridden, no shell
 * (spawn without `shell`), no credential, no retry, no silent fallback. A dead engine, a slow
 * start, an HTTP error, or malformed output all surface as typed provider errors that fail closed.
 *
 * @module models/llama-server-provider
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { ProviderError, CODES, messageOf } from '../core/errors.mjs';
import { assertLoopback } from '../core/config.mjs';

/**
 * @typedef {import('./provider.mjs').Provider} Provider
 */

/**
 * @param {{
 *   executable: string,
 *   modelPath: string,
 *   manageServer?: boolean,
 *   baseUrl?: string,
 *   port?: number,
 *   ctxSize?: number,
 *   threads?: number,
 *   startupTimeoutMs?: number,
 *   inferenceTimeoutMs?: number,
 *   temperature?: number,
 *   topK?: number,
 *   repeatPenalty?: number,
 *   maxTokens?: number,
 *   structuredMode?: string,
 *   fetchImpl?: typeof fetch
 * }} options
 * @returns {Provider & { stop: () => Promise<void>, pid: () => number|undefined, health: () => Promise<{ ok: boolean, status: string, engineVersion?: string, modelId?: string, loadMs?: number }> }}
 */
export function createLlamaServerProvider(options) {
  const {
    executable,
    modelPath,
    manageServer = true,
    ctxSize = 4096,
    threads = 4,
    startupTimeoutMs = 120000,
    inferenceTimeoutMs = 120000,
    temperature = 0.1,
    topK = 50,
    repeatPenalty = 1.05,
    maxTokens = 512,
    structuredMode = 'json_schema'
  } = options;
  const doFetch = options.fetchImpl ?? fetch;
  /** The returned object is referenced by name so methods never rely on `this` typing. */
  const self = /** @type {any} */ ({});

  if (!existsSync(executable)) {
    throw new ProviderError(CODES.PROVIDER_NOT_CONFIGURED, `llama-server executable not found: ${executable}`);
  }
  if (manageServer && !existsSync(modelPath)) {
    throw new ProviderError(CODES.PROVIDER_NOT_CONFIGURED, `model artifact not found: ${modelPath}`);
  }

  /** @type {import('node:child_process').ChildProcess|null} */
  let child = null;
  /** @type {string|null} */
  let baseUrl = options.baseUrl ?? null;
  /** @type {string|null} */
  let modelId = null;
  /** @type {number|null} */
  let loadMs = null;
  /** @type {Promise<void>|null} */
  let starting = null;

  if (baseUrl) assertLoopback(baseUrl, false, 'provider.baseUrl');

  return {
    kind: 'llama-server',
    model: modelPath,

    pid() {
      return child?.pid;
    },

    /** Spawn if needed and wait for /health to report ready. */
    async ensureStarted() {
      if (baseUrl && modelId) return;
      if (starting) return starting;
      starting = startEngine();
      try {
        await starting;
      } finally {
        starting = null;
      }
    },

    async health() {
      if (!baseUrl) return { ok: false, status: 'not-started' };
      try {
        const res = await doFetch(`${baseUrl}/health`, { method: 'GET' });
        const body = res.ok ? await res.json().catch(() => ({})) : {};
        return { ok: res.ok, status: String(body?.status ?? res.status), modelId: modelId ?? undefined, loadMs: loadMs ?? undefined };
      } catch (err) {
        return { ok: false, status: `unreachable: ${messageOf(err)}` };
      }
    },

    /**
     * @param {import('./provider.mjs').ProviderRequest} request
     * @returns {Promise<import('./provider.mjs').ProviderResult>}
     */
    async complete(request) {
      await /** @type {any} */ (this).ensureStarted();
      const deadlineMs = request.timeoutMs ?? inferenceTimeoutMs;
      const body = {
        model: modelId ?? 'local',
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage }
        ],
        stream: false,
        temperature,
        top_k: topK,
        repeat_penalty: repeatPenalty,
        max_tokens: maxTokens,
        ...(structuredMode === 'none'
          ? {}
          : {
              response_format:
                structuredMode === 'json_object'
                  ? { type: 'json_object' }
                  : {
                      type: 'json_schema',
                      json_schema: { name: 'action_proposal', strict: true, schema: request.formatSchema }
                    }
            })
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      /** @type {Response} */
      let response;
      try {
        response = await doFetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'manual'
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ProviderError(CODES.PROVIDER_TIMEOUT, `engine did not answer within ${deadlineMs} ms`, { reason: 'timeout' });
        }
        throw new ProviderError(CODES.PROVIDER_UNAVAILABLE, `engine unreachable at ${baseUrl}: ${messageOf(err)}`);
      } finally {
        clearTimeout(timer);
      }

      const raw = await response.text().catch(() => '');
      if (!response.ok) {
        throw new ProviderError(CODES.PROVIDER_HTTP_ERROR, `engine returned HTTP ${response.status}: ${raw.slice(0, 300)}`, {
          reason: `HTTP ${response.status}`
        });
      }
      /** @type {any} */
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ProviderError(CODES.PROVIDER_BAD_RESPONSE, 'engine returned a non-JSON body');
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new ProviderError(CODES.PROVIDER_BAD_RESPONSE, 'engine response did not contain choices[0].message.content');
      }
      const reasoning = data?.choices?.[0]?.message?.reasoning_content;

      return {
        text: content,
        meta: {
          provider: 'llama-server',
          model: modelId ?? 'local',
          promptTokens: typeof data?.usage?.prompt_tokens === 'number' ? data.usage.prompt_tokens : undefined,
          completionTokens: typeof data?.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : undefined,
          totalDurationMs: typeof data?.timings?.predicted_ms === 'number' ? Math.round(data.timings.predicted_ms) : undefined,
          promptEvalMs: typeof data?.timings?.prompt_ms === 'number' ? Math.round(data.timings.prompt_ms) : undefined,
          loadMs: loadMs ?? undefined,
          finishReason: typeof data?.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : undefined,
          contentChars: content.length,
          reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
          seed: undefined,
          temperature
        }
      };
    },

    /** Terminate only the engine this provider started. */
    async stop() {
      const proc = child;
      child = null;
      baseUrl = options.baseUrl ?? null;
      modelId = null;
      if (!proc || proc.pid === undefined) return;
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      await new Promise((resolve) => {
        const done = () => resolve(undefined);
        const timeout = setTimeout(done, 5000);
        proc.once('exit', () => {
          clearTimeout(timeout);
          done();
        });
        if (proc.exitCode !== null) {
          clearTimeout(timeout);
          done();
        }
      });
    }
  };

  /** @this {any} */
  async function startEngine() {
    if (!manageServer) {
      if (!baseUrl) throw new ProviderError(CODES.PROVIDER_NOT_CONFIGURED, 'llama-server provider needs baseUrl when manageServer is false');
      assertLoopback(baseUrl, false, 'provider.baseUrl');
      modelId = await readModelId(baseUrl);
      return;
    }

    const port = options.port && options.port > 0 ? options.port : await freePort();
    const url = `http://127.0.0.1:${port}`;
    const args = [
      '-m',
      modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--ctx-size',
      String(ctxSize),
      '--threads',
      String(threads),
      '--parallel',
      '1',
      '--no-warmup'
    ];
    const startedAt = Date.now();
    try {
      child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
    } catch (err) {
      throw new ProviderError(CODES.PROVIDER_UNAVAILABLE, `cannot start engine ${executable}: ${messageOf(err)}`);
    }
    child.on('error', () => {
      /* surfaced by the health poll below */
    });

    const deadline = startedAt + startupTimeoutMs;
    for (;;) {
      if (Date.now() > deadline) {
        await /** @type {any} */ (this).stop();
        throw new ProviderError(CODES.PROVIDER_TIMEOUT, `engine did not become healthy within ${startupTimeoutMs} ms`, {
          reason: 'startup timeout'
        });
      }
      if (child.exitCode !== null) {
        const exited = child.exitCode;
        child = null;
        throw new ProviderError(CODES.PROVIDER_UNAVAILABLE, `engine exited during startup (code ${exited})`);
      }
      try {
        const res = await doFetch(`${url}/health`, { method: 'GET' });
        if (res.ok) break;
      } catch {
        /* not listening yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    baseUrl = url;
    modelId = await readModelId(url);
    loadMs = Date.now() - startedAt;
  }

  /**
   * Ask the engine what it calls itself rather than assuming a name.
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async function readModelId(url) {
    try {
      const res = await doFetch(`${url}/v1/models`, { method: 'GET' });
      if (!res.ok) return null;
      const body = await res.json();
      const id = body?.data?.[0]?.id;
      return typeof id === 'string' ? id : null;
    } catch {
      return null;
    }
  }
}

/**
 * Reserve a free ephemeral loopback port by binding and releasing one.
 * @returns {Promise<number>}
 */
async function freePort() {
  const probe = createServer(() => {});
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(() => resolve(undefined)));
  return port;
}
