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
 * What the ENGINE is asked to emit (`response_format` in the live provider).
 *
 * Every field is required, with empty-string / empty-object conventions for the ones that do not
 * apply to the chosen `kind`. This exists because a JSON-Schema→grammar conversion can only
 * enforce what the schema *requires*: an earlier live run showed the model happily omitting
 * `capability` and `question` when the schema left them optional (docs/LIVE_MODEL_VALIDATION.md,
 * and research R-16 on strict-mode schemas). The parser below accepts either the all-fields form
 * or a per-kind form, so the deterministic fixtures are unaffected.
 */
export const ENVELOPE_FORMAT_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'capability', 'arguments', 'question', 'reason', 'reasoningSummary'],
  properties: {
    kind: { type: 'string', enum: ['proposal', 'clarification', 'unsupported'] },
    capability: { type: 'string', maxLength: 64, description: 'Capability id for a proposal; empty string otherwise.' },
    arguments: { type: 'object', description: 'Arguments for a proposal; empty object otherwise.' },
    question: { type: 'string', maxLength: 300, description: 'The question for a clarification; empty string otherwise.' },
    reason: { type: 'string', maxLength: 300, description: 'The reason for an unsupported reply; empty string otherwise.' },
    reasoningSummary: { type: 'string', minLength: 1, maxLength: 500 },
    proposalId: { type: 'string', maxLength: 64 }
  }
});

/**
 * The envelope the harness accepts. Conditional requirements (proposal needs a capability and
 * arguments; clarification needs a question) are enforced in code, because this schema subset
 * cannot express conditionals — see core/schema.mjs.
 */
export const ENVELOPE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'reasoningSummary'],
  properties: {
    kind: { type: 'string', enum: ['proposal', 'clarification', 'unsupported'] },
    reasoningSummary: { type: 'string', minLength: 1, maxLength: 500 },
    proposalId: { type: 'string', maxLength: 64 },
    capability: { type: 'string', maxLength: 64 },
    arguments: { type: 'object' },
    question: { type: 'string', maxLength: 300 },
    reason: { type: 'string', maxLength: 300 }
  }
});

/**
 * Load the resident prompt files and return them with content hashes (recorded in evidence and in
 * benchmark reports so a prompt change is never mistaken for a model improvement: R-42).
 * @param {string} sopPath
 * @param {string} [baseContractPath]
 * @param {string} [doctrinePath]  When provided, the compact accounting doctrine is injected too.
 * @returns {{ text: string, hash: string, baseContractText: string, baseContractHash: string, doctrineText: string, doctrineHash: string }}
 */
export function loadSop(sopPath, baseContractPath, doctrinePath) {
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
    let doctrineText = '';
    let doctrineHash = '';
    if (doctrinePath) {
      doctrineText = readFileSync(doctrinePath, 'utf8').trim();
      if (doctrineText.length < 200) {
        throw new ConfigError(CODES.CONFIG_INVALID, `accounting doctrine at ${doctrinePath} is suspiciously short`);
      }
      doctrineHash = sha256Hex(doctrineText);
    }
    return { text, hash: sha256Hex(text), baseContractText, baseContractHash, doctrineText, doctrineHash };
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(CODES.CONFIG_INVALID, `cannot read resident prompt files: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Compose the system prompt. Order is deliberate (research R-21): the always-on contract and the
 * SOP come first, then the bounded capability context, and the response contract comes last so
 * the most safety-critical instructions sit at the strongest positions.
 *
 * `mode` exists for the live-model experiment only (directive §5 Arm C): 'minimal' omits the
 * resident contract and the SOP, supplying only the capability context and the response contract
 * that the harness must have in order to parse anything at all. It is never a production mode —
 * the harness's authority, policy, permits and verification are identical in both modes.
 * @param {{ sopText: string, contextText: string, baseContractText?: string, doctrineText?: string, mode?: 'full'|'minimal' }} options
 * @returns {string}
 */
export function buildSystemPrompt(options) {
  const { sopText, contextText } = options;
  const mode = options.mode === 'minimal' ? 'minimal' : 'full';
  const baseContractText = mode === 'minimal' ? '' : options.baseContractText ?? '';
  const doctrineText = mode === 'minimal' ? '' : options.doctrineText ?? '';
  const sopTextFinal = mode === 'minimal' ? '' : sopText;
  return [
    ...(baseContractText.length > 0 ? ['<resident_base_contract>', baseContractText, '</resident_base_contract>', ''] : []),
    ...(doctrineText.length > 0 ? ['<accountants_way>', doctrineText, '</accountants_way>', ''] : []),
    ...(sopTextFinal.length > 0 ? ['<resident_sop>', sopTextFinal, '</resident_sop>', ''] : []),
    '<capability_context>',
    'These are the only operations available for this request. Nothing else exists.',
    '',
    contextText,
    '</capability_context>',
    '',
    '<response_contract>',
    'Reply with EXACTLY ONE JSON object. No prose, no markdown fences, no second object.',
    '',
    'Always include ALL SIX fields. Use an empty string "" or an empty object {} for the fields that',
    'do not apply to the shape you chose.',
    '',
    'Shapes:',
    '{"kind":"proposal","capability":"<id from capability_context>","arguments":{...},"question":"","reason":"","reasoningSummary":"<why this is the right operation>"}',
    '{"kind":"clarification","capability":"","arguments":{},"question":"<the single question you need answered>","reason":"","reasoningSummary":"<why you must ask>"}',
    '{"kind":"unsupported","capability":"","arguments":{},"question":"","reason":"<why no listed capability can perform this>","reasoningSummary":"<why>"}',
    '',
    'Rules:',
    '1. "capability" MUST be one of the ids listed in capability_context, and must be filled in for a proposal.',
    '2. "arguments" MUST contain every required argument for that capability, with the documented shape, and must not contain unknown fields.',
    '3. Do not include risk, permission, confirmation, or endpoint fields. The harness owns those.',
    '4. If a required value is missing, apply RETRIEVE BEFORE CLARIFY: if a listed read or resolution capability can obtain it from what the user already gave, propose that capability — do not ask the user for something the system exists to look up. Ask with kind="clarification" only when the value cannot be retrieved, or when retrieval returned several plausible records. Never invent a value.',
    '5. If no listed capability can perform the request, use kind="unsupported". Do not attempt an approximation.',
    '6. Do not claim that anything has been executed, created, issued, or saved. You are proposing only.',
    '7. "reasoningSummary" is required in all three shapes and must be at most 500 characters.',
    '</response_contract>'
  ].join('\n');
}
