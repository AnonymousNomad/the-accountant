/**
 * The model provider boundary.
 *
 * A provider returns TEXT. It has no authority, no capability awareness, and no knowledge of
 * policy, adapters, or evidence. Swapping the runtime must not change anything else in the
 * system — that is the entire point of this interface (docs/ARCHITECTURE.md §2).
 *
 * @module models/provider
 */

import { ProviderError, CODES } from '../core/errors.mjs';
import { createOllamaProvider } from './ollama-provider.mjs';
import { createScriptedProvider } from './scripted-provider.mjs';
import { createLlamaServerProvider } from './llama-server-provider.mjs';

/**
 * @typedef {object} ProviderRequest
 * @property {string} systemPrompt
 * @property {string} userMessage
 * @property {Record<string, unknown>} [formatSchema]  Required by the JSON-envelope protocol; unused by the native tool-call protocol.
 * @property {Array<Record<string, unknown>>} [tools]  Native tool-call protocol: the callable surface (see models/ollama-provider.mjs, toolsFromDefinitions).
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {object} ProviderResult
 * @property {string} text
 * @property {{ provider: string, model: string, doneReason?: string, evalCount?: number, totalDurationMs?: number, loadDurationMs?: number, loadMs?: number, serverVersion?: string|null, seed?: number, temperature?: number, promptTokens?: number, completionTokens?: number, promptEvalMs?: number, finishReason?: string, contentChars?: number, reasoningChars?: number, toolCallMode?: string, promptEvalCount?: number, evalMs?: number, promptEvalTokensPerSecond?: number, evalTokensPerSecond?: number, toolCalls?: number }} meta
 */

/**
 * @typedef {object} Provider
 * @property {string} kind
 * @property {string} model
 * @property {(request: ProviderRequest) => Promise<ProviderResult>} complete
 * @property {() => Promise<string|null>} [getVersion]
 * @property {() => Promise<void>} [stop]
 * @property {() => Promise<void>} [ensureStarted]
 * @property {() => Promise<{ ok: boolean, status: string, modelId?: string, loadMs?: number }>} [health]
 * @property {() => number|undefined} [pid]
 */

/**
 * Build a provider from trusted configuration.
 * @param {any} providerConfig  Validated by core/config.mjs before it reaches this factory.
 * @param {{ script?: Array<{ prompt: string, response: string }>, fetchImpl?: typeof fetch }} [options]
 * @returns {Provider}
 */
export function createProvider(providerConfig, options = {}) {
  switch (providerConfig.kind) {
    case 'ollama':
      return createOllamaProvider({
        baseUrl: providerConfig.baseUrl,
        model: providerConfig.model,
        timeoutMs: providerConfig.timeoutMs,
        numCtx: providerConfig.numCtx,
        keepAlive: providerConfig.keepAlive,
        seed: providerConfig.seed,
        temperature: providerConfig.temperature,
        allowNonLocalProvider: providerConfig.allowNonLocalProvider,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
      });
    case 'scripted':
      return createScriptedProvider({ script: options.script ?? [] });
    case 'llama-server':
      return createLlamaServerProvider({
        executable: String(providerConfig.executable ?? ''),
        modelPath: String(providerConfig.modelPath ?? ''),
        manageServer: providerConfig.manageServer !== false,
        baseUrl: providerConfig.baseUrl,
        port: providerConfig.port ?? 0,
        ctxSize: providerConfig.numCtx,
        threads: providerConfig.threads ?? 4,
        startupTimeoutMs: providerConfig.startupTimeoutMs ?? 120000,
        inferenceTimeoutMs: providerConfig.inferenceTimeoutMs ?? providerConfig.timeoutMs ?? 120000,
        temperature: providerConfig.temperature,
        topK: providerConfig.topK ?? 50,
        repeatPenalty: providerConfig.repeatPenalty ?? 1.05,
        maxTokens: providerConfig.maxTokens ?? 512,
        structuredMode: providerConfig.structuredMode ?? 'json_schema',
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
      });
    default:
      throw new ProviderError(CODES.PROVIDER_NOT_CONFIGURED, `unsupported provider kind "${providerConfig.kind}"`);
  }
}
