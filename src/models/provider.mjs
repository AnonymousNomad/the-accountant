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

/**
 * @typedef {object} ProviderRequest
 * @property {string} systemPrompt
 * @property {string} userMessage
 * @property {Record<string, unknown>} formatSchema
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {object} ProviderResult
 * @property {string} text
 * @property {{ provider: string, model: string, doneReason?: string, evalCount?: number, totalDurationMs?: number, loadDurationMs?: number, serverVersion?: string|null, seed?: number, temperature?: number }} meta
 */

/**
 * @typedef {object} Provider
 * @property {string} kind
 * @property {string} model
 * @property {(request: ProviderRequest) => Promise<ProviderResult>} complete
 * @property {() => Promise<string|null>} [getVersion]
 */

/**
 * Build a provider from trusted configuration.
 * @param {{ kind: string, baseUrl: string, model: string, timeoutMs: number, numCtx: number, keepAlive: string, seed: number, temperature: number, allowNonLocalProvider: boolean }} providerConfig
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
    default:
      throw new ProviderError(CODES.PROVIDER_NOT_CONFIGURED, `unsupported provider kind "${providerConfig.kind}"`);
  }
}
