/**
 * Prompt construction: the SOP, the bounded capability context, and the response contract.
 *
 * Ordering is deliberate (research R-21, position effects): the resident SOP and the
 * capability context come first, and the response contract comes last, so the two most
 * important blocks sit at the strongest positions. The envelope schema is restated even
 * though the runtime also receives it as a `format` constraint (R-03, R-15/R-18: a grammar
 * guarantees shape at best, and some runtimes silently ignore parts of a schema).
 *
 * @module models/prompt
 */

import { readFileSync } from 'node:fs';
import { sha256Hex } from '../core/canonical.mjs';
import { ConfigError, CODES } from '../core/errors.mjs';
import { deepFreeze } from '../core/util.mjs';

/**
 * The response envelope. Root is a single object; `additionalProperties: false` everywhere;
 * conditional requirements (proposal needs proposalId/capability/arguments) are enforced in
 * code because this schema subset cannot express conditionals (see core/schema.mjs).
 */
export const ENVELOPE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'reasoningSummary'],
  properties: {
    kind: { type: 'string', enum: ['proposal', 'clarification', 'unsupported'] },
    reasoningSummary: { type: 'string', minLength: 1, maxLength: 500 },
    proposalId: { type: 'string', minLength: 1, maxLength: 64 },
    capability: { type: 'string', minLength: 3, maxLength: 64 },
    arguments: { type: 'object' },
    question: { type: 'string', minLength: 1, maxLength: 300 },
    reason: { type: 'string', minLength: 1, maxLength: 300 }
  }
});

/**
 * Load the resident SOP from disk and return it with a content hash (recorded in evidence and
 * in benchmark reports so a prompt change is never mistaken for a model improvement: R-42).
 * @param {string} sopPath
 * @param {string} [baseContractPath]
 * @returns {{ text: string, hash: string, baseContractText: string, baseContractHash: string }}
 */
export function loadSop(sopPath, baseContractPath) {
  try {
    const text = readFileSync(sopPath, 'utf8').trim();
    if (text.length < 100) {
      throw new ConfigError(CODES.CONFIG_INVALID, `resident SOP at ${sopPath} is suspiciously short`);
    }
    let baseContractText = '';
    let baseContractHash = '';
    if (baseContractPath) {
      baseContractText = readFileSync(baseContractPath, 'utf8').trim();
      if (baseContractText.length < 100) {
        throw new ConfigError(CODES.CONFIG_INVALID, `resident base contract at ${baseContractPath} is suspiciously short`);
      }
      baseContractHash = sha256Hex(baseContractText);
    }
    return { text, hash: sha256Hex(text), baseContractText, baseContractHash };
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(CODES.CONFIG_INVALID, `cannot read resident prompt files: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Compose the system prompt. Order is deliberate (research R-21): the always-on contract and the
 * SOP come first, then the bounded capability context, and the response contract comes last so
 * the most safety-critical instructions sit at the strongest positions.
 * @param {{ sopText: string, contextText: string, baseContractText?: string }} options
 * @returns {string}
 */
export function buildSystemPrompt(options) {
  const { sopText, contextText } = options;
  const baseContractText = options.baseContractText ?? '';
  return [
    ...(baseContractText.length > 0 ? ['<resident_base_contract>', baseContractText, '</resident_base_contract>', ''] : []),
    '<resident_sop>',
    sopText,
    '</resident_sop>',
    '',
    '<capability_context>',
    'These are the only operations available for this request. Nothing else exists.',
    '',
    contextText,
    '</capability_context>',
    '',
    '<response_contract>',
    'Reply with EXACTLY ONE JSON object. No prose, no markdown fences, no second object.',
    '',
    'Shape:',
    '{"kind":"proposal","proposalId":"p-<short-unique-id>","capability":"<id from capability_context>","arguments":{...},"reasoningSummary":"<why this is the right operation>"}',
    '{"kind":"clarification","question":"<the single question you need answered>","reasoningSummary":"<why you must ask>"}',
    '{"kind":"unsupported","reason":"<why no listed capability can perform this>","reasoningSummary":"<why>"}',
    '',
    'Rules:',
    '1. "capability" MUST be one of the ids listed in capability_context. Never invent an id.',
    '2. "arguments" MUST contain every required argument, with the documented shape, and must not contain unknown fields.',
    '3. Do not include risk, permission, confirmation, or endpoint fields. The harness owns those.',
    '4. If information required by the capability is missing from the user\'s request, use kind="clarification" and ask for exactly what is missing. Never invent a value.',
    '5. If no listed capability can perform the request, use kind="unsupported". Do not attempt an approximation.',
    '6. Do not claim that anything has been executed, created, issued, or saved. You are proposing only.',
    '7. "reasoningSummary" is required in all three shapes and must be at most 500 characters.',
    '</response_contract>'
  ].join('\n');
}
