/**
 * Scripted provider — a fixture replay used by tests, CI, and the scripted demo.
 *
 * This is NOT a model and must never be described as model capability. It exists because
 * (a) the harness pipeline must be testable end to end without an external runtime, and
 * (b) reproducibility for the harness's own behaviour is required by the benchmark
 * methodology (docs/research/RESEARCH_LEDGER.md R-28, R-50: real inference is not
 * bit-reproducible, but fixture replay is).
 *
 * It returns text and nothing else: every validation, policy, authority, execution, and
 * verification step runs identically to a real-model turn. There is no shortcut path.
 *
 * @module models/scripted-provider
 */

import { ProviderError, CODES } from '../core/errors.mjs';

/**
 * @typedef {import('./provider.mjs').Provider} Provider
 */

/**
 * @param {{ script?: Array<{ prompt: string, response: string }> }} [options]
 * @returns {Provider & { respondWith: (response: unknown) => void, remaining: () => number }}
 */
export function createScriptedProvider(options = {}) {
  /** @type {Map<string, string>} */
  const byPrompt = new Map();
  for (const entry of options.script ?? []) {
    if (!entry || typeof entry.prompt !== 'string' || typeof entry.response !== 'string') {
      throw new ProviderError(CODES.PROVIDER_NOT_CONFIGURED, 'script entries must be { prompt: string, response: string }');
    }
    byPrompt.set(entry.prompt, entry.response);
  }
  /** @type {string[]} */
  const queue = [];

  return {
    kind: 'scripted',
    model: 'scripted-fixture',

    /**
     * Queue the next fixture response (used by tests and the benchmark runner).
     * @param {unknown} response
     */
    respondWith(response) {
      queue.push(typeof response === 'string' ? response : JSON.stringify(response));
    },

    /** @returns {number} */
    remaining() {
      return queue.length;
    },

    /**
     * @param {import('./provider.mjs').ProviderRequest} request
     * @returns {Promise<import('./provider.mjs').ProviderResult>}
     */
    async complete(request) {
      if (queue.length > 0) {
        const text = /** @type {string} */ (queue.shift());
        return { text, meta: { provider: 'scripted', model: 'scripted-fixture' } };
      }
      const scripted = byPrompt.get(request.userMessage);
      if (typeof scripted === 'string') {
        return { text: scripted, meta: { provider: 'scripted', model: 'scripted-fixture', seed: 0, temperature: 0 } };
      }
      throw new ProviderError(
        CODES.SCRIPT_EXHAUSTED,
        'scripted provider has no response for this input; refusing to invent one',
        { reason: 'script exhausted' }
      );
    }
  };
}
