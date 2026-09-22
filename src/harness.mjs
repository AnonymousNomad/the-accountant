/**
 * The harness: one turn, one model call, at most one action, always evidence.
 *
 * Ordering is the security property (docs/ARCHITECTURE.md §1, §4):
 *   validate → policy → (confirm) → permit → consume → execute → verify → record.
 * Nothing in this file can skip a step: the status returned is derived from the events that
 * actually happened, and every terminal status is in one closed set. If evidence cannot be
 * written before execution, execution does not happen (FAILURE_MATRIX F-26).
 *
 * @module harness
 */

import { AuthorityError, EvidenceError, HarnessError, PolicyError, ProposalError, ProviderError, CODES, codeOf, messageOf } from './core/errors.mjs';
import { hashAction, sha256Hex, canonicalJson } from './core/canonical.mjs';
import { makeId, deepFreeze } from './core/util.mjs';
import { validate } from './core/schema.mjs';
import { buildCapabilityContext } from './registry/context.mjs';
import { buildSystemPrompt, ENVELOPE_FORMAT_SCHEMA } from './models/prompt.mjs';
import { parseEnvelope } from './models/response-parser.mjs';
import { DECISION } from './policy/policy-engine.mjs';
import { EVENT } from './evidence/journal.mjs';

/** The closed set of terminal statuses. Only EXECUTED_VERIFIED may be called success. */
export const STATUS = Object.freeze({
  EXECUTED_VERIFIED: 'EXECUTED_VERIFIED',
  CLARIFICATION_REQUIRED: 'CLARIFICATION_REQUIRED',
  UNSUPPORTED: 'UNSUPPORTED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CONFIRMATION_REJECTED: 'CONFIRMATION_REJECTED',
  DENIED: 'DENIED',
  REJECTED: 'REJECTED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  COMMIT_UNKNOWN: 'COMMIT_UNKNOWN',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  EVIDENCE_ERROR: 'EVIDENCE_ERROR'
});

export const SUCCESS_STATUSES = Object.freeze([STATUS.EXECUTED_VERIFIED]);
/** Statuses where the harness behaved correctly and no operator intervention is implied. */
export const NORMAL_STATUSES = Object.freeze([
  STATUS.EXECUTED_VERIFIED,
  STATUS.CLARIFICATION_REQUIRED,
  STATUS.UNSUPPORTED,
  STATUS.CONFIRMATION_REQUIRED
]);

/**
 * @typedef {object} HarnessResult
 * @property {string} runId
 * @property {number} turn
 * @property {string} status
 * @property {string} message
 * @property {Record<string, unknown>|null} proposal
 * @property {string|null} capability
 * @property {string|null} risk
 * @property {Record<string, unknown>|null} policyDecision
 * @property {string|null} permitId
 * @property {{ confirmationId: string, expiresAt: string }|null} confirmation
 * @property {{ ok: boolean, code?: string, detail?: string, data?: Record<string, unknown> }|null} execution
 * @property {{ passed: boolean, checks: Array<{ check: string, ok: boolean, detail?: string }> }|null} verification
 * @property {{ context?: Record<string, unknown>, provider?: Record<string, unknown> }} [diagnostics]
 * @property {{ seqs: number[], lastSeq: number }} evidence
 * @property {Record<string, number>} timingsMs
 */

/**
 * @param {object} deps
 * @param {any} deps.config
 * @param {string} deps.configHash
 * @param {import('./registry/registry.mjs').Registry} deps.registry
 * @param {any} deps.provider
 * @param {any} deps.journal
 * @param {any} deps.authority
 * @param {any} deps.confirmations
 * @param {any} deps.policy
 * @param {{ mock: any, http: any }} deps.adapters
 * @param {any} deps.verifiers
 * @param {(checkId: string, capabilityId: string) => { available: boolean, detail?: string }} deps.prerequisite
 * @param {{ text: string, hash: string, baseContractText?: string, baseContractHash?: string, doctrineText?: string, doctrineHash?: string }} deps.sop
 * @param {string} deps.sessionId
 * @param {import('./core/util.mjs').Clock} deps.clock
 * @param {boolean} [deps.includeContextText]
 * @param {'full'|'minimal'} [deps.promptMode]  Live-experiment control (Arm C); authority is unaffected.
 */
export function createHarness(deps) {
  const {
    config,
    configHash,
    registry,
    provider,
    journal,
    authority,
    confirmations,
    policy,
    adapters,
    verifiers,
    prerequisite,
    sop,
    sessionId,
    clock
  } = deps;
  const includeContextText = deps.includeContextText === true;
  const promptMode = deps.promptMode === 'minimal' ? 'minimal' : 'full';

  let turn = 0;
  const seenProposalIds = new Set();

  return {
    sessionId,
    providerKind: provider.kind,
    providerModel: provider.model,
    get turn() {
      return turn;
    },

    /**
     * One user instruction: capability context → model → validate → policy → (confirm) → run.
     * @param {string} text
     * @returns {Promise<HarnessResult>}
     */
    async handleUserMessage(text) {
      turn += 1;
      const currentTurn = turn;
      const runId = makeId('run');
      const startedAt = Date.now();
      /** @type {number[]} */
      const seqs = [];
      /** @type {(type: string, fields?: Record<string, unknown>) => Promise<any>} */
      const record = async (type, fields = {}) => {
        const event = await journal.append(type, { runId, ...fields });
        seqs.push(event.seq);
        return event;
      };

      try {
        await record(EVENT.USER_INSTRUCTION, { data: { text, turn: currentTurn } });

        for (const confirmationId of confirmations.invalidateForNewTurn(currentTurn)) {
          await record(EVENT.CONFIRMATION_REJECTED, {
            data: { confirmationId, code: CODES.CONFIRMATION_SUPERSEDED, reason: 'a new instruction arrived' }
          });
        }

        const context = buildCapabilityContext({
          registry,
          config,
          taskText: text,
          prerequisite,
          nowIso: () => clock.nowIso()
        });
        await record(EVENT.CAPABILITIES_EXPOSED, {
          data: {
            snapshotId: context.snapshotId,
            actorId: context.actorId,
            workspaceId: context.workspaceId,
            createdAt: context.createdAt,
            registryHash: context.registryHash,
            registrySize: context.registrySize,
            contextHash: context.contextHash,
            capabilities: context.capabilities,
            exposed: context.ids,
            filtered: context.filtered,
            candidates: context.candidates,
            domains: context.domains,
            taskKeywords: context.taskKeywords,
            budget: context.budget,
            discoveryVersion: context.discoveryVersion,
            ranked: context.ranked,
            sopHash: sop.hash,
            baseContractHash: sop.baseContractHash ?? null,
            doctrineHash: sop.doctrineHash ?? null,
            promptMode,
            configHash,
            ...(includeContextText ? { contextText: context.text } : {})
          }
        });

        const systemPrompt = buildSystemPrompt({
          sopText: sop.text,
          baseContractText: sop.baseContractText ?? '',
          doctrineText: sop.doctrineText ?? '',
          contextText: context.text,
          mode: promptMode
        });

        const providerStart = Date.now();
        /** @type {{ text: string, meta: Record<string, unknown> }} */
        let completion;
        try {
          completion = await provider.complete({ systemPrompt, userMessage: text, formatSchema: envelopeFormatSchema() });
        } catch (err) {
          const code = codeOf(err);
          await record(EVENT.PROVIDER_ERROR, {
            data: { code, detail: messageOf(err), provider: provider.kind, model: provider.model }
          });
          return finish(STATUS.PROVIDER_ERROR, `${messageOf(err)}`, {
            providerMs: Date.now() - providerStart,
            contextHash: context.contextHash
          });
        }
        const providerMs = Date.now() - providerStart;

        /** @type {import('./models/response-parser.mjs').Envelope} */
        let envelope;
        try {
          envelope = parseEnvelope(completion.text);
        } catch (err) {
          const detail = messageOf(err);
          await record(EVENT.PROPOSAL_REJECTED, { data: { stage: 'parse', code: codeOf(err), detail } });
          return finish(STATUS.REJECTED, `the model response could not be used: ${detail}`, {
            providerMs,
            contextHash: context.contextHash
          });
        }

        if (envelope.kind === 'clarification') {
          await record(EVENT.CLARIFICATION_REQUESTED, { data: { question: envelope.question } });
          return finish(STATUS.CLARIFICATION_REQUIRED, envelope.question, { providerMs, contextHash: context.contextHash });
        }
        if (envelope.kind === 'unsupported') {
          await record(EVENT.UNSUPPORTED_REQUEST, { data: { reason: envelope.reason } });
          return finish(STATUS.UNSUPPORTED, envelope.reason, { providerMs, contextHash: context.contextHash });
        }

        // ---- validation
        const normalizedId = normalizeProposalId(envelope.proposalId, envelope.capability, envelope.arguments);
        if (seenProposalIds.has(normalizedId)) {
          await record(EVENT.PROPOSAL_REJECTED, {
            proposalId: normalizedId,
            data: { stage: 'validation', code: CODES.PROPOSAL_ID_REPLAY, detail: 'proposalId was already used in this session' }
          });
          return finish(STATUS.REJECTED, `proposalId "${normalizedId}" was already used in this session`, {
            providerMs,
            contextHash: context.contextHash
          });
        }

        const capability = registry.get(envelope.capability);
        if (!capability) {
          await record(EVENT.PROPOSAL_REJECTED, {
            proposalId: envelope.proposalId,
            capability: envelope.capability,
            data: {
              stage: 'validation',
              code: 'UNKNOWN_CAPABILITY',
              detail: `no registered capability "${envelope.capability}"`,
              exposed: context.ids
            }
          });
          return finish(STATUS.REJECTED, `no registered capability "${envelope.capability}"`, {
            providerMs,
            contextHash: context.contextHash
          });
        }
        if (!context.ids.includes(capability.id)) {
          await record(EVENT.PROPOSAL_REJECTED, {
            proposalId: envelope.proposalId,
            capability: capability.id,
            data: {
              stage: 'validation',
              code: 'CAPABILITY_NOT_EXPOSED',
              detail: 'the capability was not offered in this turn\'s capability context',
              exposed: context.ids
            }
          });
          return finish(STATUS.REJECTED, `"${capability.id}" was not among the capabilities offered for this request`, {
            providerMs,
            contextHash: context.contextHash
          });
        }

        const issues = validate(envelope.arguments, /** @type {Record<string, unknown>} */ (capability.inputSchema));
        if (issues.length > 0) {
          const rendered = issues.map((i) => `${i.path} ${i.message}`).join('; ');
          await record(EVENT.PROPOSAL_REJECTED, {
            proposalId: envelope.proposalId,
            capability: capability.id,
            data: { stage: 'validation', code: 'ARGUMENTS_INVALID', detail: rendered, issues }
          });
          return finish(STATUS.REJECTED, `arguments for ${capability.id} are not valid: ${rendered}`, {
            providerMs,
            contextHash: context.contextHash
          });
        }

        seenProposalIds.add(normalizedId);
        const proposal = deepFreeze({
          proposalId: normalizedId,
          capability: capability.id,
          arguments: envelope.arguments,
          reasoningSummary: envelope.reasoningSummary
        });
        const proposalHash = hashAction(capability.id, envelope.arguments);

        await record(EVENT.PROPOSED, {
          proposalId: proposal.proposalId,
          proposalHash,
          capability: capability.id,
          risk: capability.risk,
          data: {
            arguments: envelope.arguments,
            reasoningSummary: envelope.reasoningSummary,
            modelProposalId: envelope.proposalId,
            capabilityDefinitionHash: capability.definitionHash,
            registryHash: context.registryHash
          }
        });

        // ------------------------------------------------------------ policy
        const decision = policy.evaluate({ capabilityId: capability.id, context });
        await record(EVENT.POLICY_DECISION, {
          proposalId: proposal.proposalId,
          proposalHash,
          capability: capability.id,
          risk: capability.risk,
          data: { decision: decision.decision, reason: decision.reason, detail: decision.detail ?? null }
        });

        if (decision.decision === DECISION.DENY) {
          await record(EVENT.DENIED, {
            proposalId: proposal.proposalId,
            proposalHash,
            capability: capability.id,
            risk: capability.risk,
            data: { stage: 'policy', reason: decision.reason, detail: decision.detail ?? null }
          });
          return finish(STATUS.DENIED, `policy denied ${capability.id}: ${decision.detail ?? decision.reason}`, {
            providerMs,
            contextHash: context.contextHash,
            proposal,
            capability: capability.id,
            risk: capability.risk,
            policyDecision: decision
          });
        }

        if (decision.decision === DECISION.CONFIRMATION_REQUIRED) {
          const { confirmation, superseded } = confirmations.arm({
            runId,
            turn: currentTurn,
            proposal,
            proposalHash,
            capability: capability.id,
            capabilityVersion: capability.version,
            capabilitySnapshotId: context.snapshotId,
            actorId: context.actorId,
            workspaceId: context.workspaceId,
            risk: capability.risk
          });
          await record(EVENT.CONFIRMATION_REQUIRED, {
            proposalId: proposal.proposalId,
            proposalHash,
            capability: capability.id,
            risk: capability.risk,
            data: {
              confirmationId: confirmation.confirmationId,
              requirement: decision.requirement ?? decision.reason,
              expiresAt: new Date(confirmation.expiresAt).toISOString(),
              superseded
            }
          });
          return finish(
            STATUS.CONFIRMATION_REQUIRED,
            `confirmation required for ${capability.id} (risk ${capability.risk}). Reply yes to approve or no to decline.`,
            {
              providerMs,
              contextHash: context.contextHash,
              proposal,
              capability: capability.id,
              risk: capability.risk,
              policyDecision: decision,
              confirmation: {
                confirmationId: confirmation.confirmationId,
                expiresAt: new Date(confirmation.expiresAt).toISOString()
              }
            }
          );
        }

        return await execute({
          runId,
          proposal,
          proposalHash,
          capabilityId: capability.id,
          risk: capability.risk,
          policyDecision: decision,
          confirmationId: null,
          context,
          providerMs,
          contextHash: context.contextHash,
          actor: 'policy-allow'
        });
      } catch (err) {
        return await failureResult(err, { runId, seqs, startedAt });
      }

      /**
       * @param {string} status
       * @param {string} message
       * @param {Record<string, unknown>} [extra]
       * @returns {HarnessResult}
       */
      function finish(status, message, extra = {}) {
        return buildResult({ runId, turn: currentTurn, status, message, seqs, startedAt, ...extra });
      }
    },

    /**
     * Resolve an operator answer to a pending confirmation. Approving resumes the SAME frozen
     * proposal — never a fresh model response (docs/ARCHITECTURE.md I-3).
     * @param {string} text
     * @returns {Promise<HarnessResult>}
     */
    async confirm(text) {
      const runId = makeId('run');
      const startedAt = Date.now();
      /** @type {number[]} */
      const seqs = [];
      /** @type {(type: string, fields?: Record<string, unknown>) => Promise<any>} */
      const record = async (type, fields = {}) => {
        const event = await journal.append(type, { runId, ...fields });
        seqs.push(event.seq);
        return event;
      };

      try {
        const resolution = confirmations.resolve({ text, turn });

        if (resolution.ok === false) {
          await record(EVENT.CONFIRMATION_REJECTED, { data: { code: resolution.code, detail: resolution.detail, answer: text } });
          return buildResult({
            runId,
            turn,
            status: STATUS.CONFIRMATION_REJECTED,
            message: resolution.detail,
            seqs,
            startedAt,
            policyDecision: null
          });
        }

        const confirmation = resolution.confirmation;
        if (resolution.decision === 'DECLINED') {
          await record(EVENT.CONFIRMATION_REJECTED, {
            proposalId: String(confirmation.proposal.proposalId ?? ''),
            proposalHash: confirmation.proposalHash,
            capability: confirmation.capability,
            risk: confirmation.risk,
            data: { code: CODES.CONFIRMATION_DECLINED, detail: 'the operator declined', confirmationId: confirmation.confirmationId }
          });
          return buildResult({
            runId,
            turn,
            status: STATUS.CONFIRMATION_REJECTED,
            message: `declined: ${confirmation.capability} was not executed`,
            seqs,
            startedAt,
            proposal: /** @type {Record<string, unknown>} */ (confirmation.proposal),
            capability: confirmation.capability,
            risk: confirmation.risk,
            policyDecision: null
          });
        }

        const capability = registry.get(confirmation.capability);
        if (!capability) {
          await record(EVENT.CONFIRMATION_REJECTED, {
            data: { code: 'UNKNOWN_CAPABILITY', detail: 'the confirmed capability is no longer registered' }
          });
          return buildResult({
            runId,
            turn,
            status: STATUS.REJECTED,
            message: `capability "${confirmation.capability}" is no longer registered; nothing executed`,
            seqs,
            startedAt,
            policyDecision: null
          });
        }

        const recomputedHash = hashAction(capability.id, /** @type {Record<string, unknown>} */ (confirmation.proposal.arguments));
        if (recomputedHash !== confirmation.proposalHash) {
          await record(EVENT.CONFIRMATION_REJECTED, {
            capability: capability.id,
            data: {
              code: CODES.PROPOSAL_MISMATCH,
              detail: 'the frozen proposal no longer hashes to the approved value; refusing to execute'
            }
          });
          return buildResult({
            runId,
            turn,
            status: STATUS.REJECTED,
            message: 'the approved proposal failed an integrity re-check; nothing executed',
            seqs,
            startedAt,
            policyDecision: null
          });
        }

        await record(EVENT.CONFIRMATION_GRANTED, {
          proposalId: String(confirmation.proposal.proposalId ?? ''),
          proposalHash: confirmation.proposalHash,
          capability: capability.id,
          risk: capability.risk,
          data: {
            confirmationId: confirmation.confirmationId,
            answer: text.trim(),
            source: 'operator',
            originRunId: confirmation.runId,
            originTurn: confirmation.armedTurn
          }
        });

        return await execute({
          runId,
          proposal: /** @type {Record<string, unknown>} */ (confirmation.proposal),
          proposalHash: confirmation.proposalHash,
          capabilityId: capability.id,
          risk: capability.risk,
          policyDecision: { decision: DECISION.ALLOW, reason: 'CONFIRMED' },
          confirmationId: confirmation.confirmationId,
          originRunId: confirmation.runId,
          context: {
            snapshotId: confirmation.capabilitySnapshotId,
            actorId: confirmation.actorId,
            workspaceId: confirmation.workspaceId
          },
          providerMs: 0,
          contextHash: null,
          actor: 'operator-confirmation'
        });
      } catch (err) {
        return await failureResult(err, { runId, seqs, startedAt });
      }
    },

    /** Exposed for tests and the CLI's `:verify-chain`. */
    async verifyEvidence() {
      return journal.verifyChain();
    },

    /**
     * The capability context that WOULD be built for a given instruction. Read-only: it
     * neither calls the model nor creates any authority. Used by `:capabilities` so an
     * operator can see exactly what a small model would be given.
     * @param {string} [text]
     */
    previewContext(text = '') {
      return buildCapabilityContext({ registry, config, taskText: text, prerequisite });
    }
  };

  /**
   * @param {{ runId: string, proposal: Record<string, unknown>, proposalHash: string, capabilityId: string, risk: string, policyDecision: any, confirmationId: string|null, context?: any, originRunId?: string|null, providerMs?: number, contextHash?: string|null, actor?: string }} input
   * @returns {Promise<HarnessResult>}
   */
  async function execute(input) {
    const { runId, proposal, proposalHash, capabilityId, risk, policyDecision, confirmationId, context } = input;
    const originRunId = typeof input.originRunId === 'string' ? input.originRunId : null;
    const capability = registry.get(capabilityId);
    if (!capability) {
      throw new HarnessError(CODES.CAPABILITY_INVALID, `capability "${capabilityId}" vanished between policy and execution`);
    }
    // Revocation between proposal and execution: a disabled capability cannot execute.
    if (!capability.enabled) {
      const event = await journal.append(EVENT.DENIED, {
        runId,
        proposalId: String(proposal.proposalId ?? ''),
        capability: capabilityId,
        data: { stage: 'pre-execution', code: 'CAPABILITY_DISABLED', detail: 'the capability was disabled after the proposal' }
      });
      return buildResult({
        runId,
        turn,
        status: STATUS.DENIED,
        message: `capability "${capabilityId}" is disabled; nothing executed`,
        seqs: [event.seq],
        startedAt: Date.now(),
        proposal,
        capability: capabilityId,
        risk,
        policyDecision
      });
    }
    const actorId = String(context?.actorId ?? config.identity.actorId);
    const workspaceId = String(context?.workspaceId ?? config.identity.workspaceId);
    const capabilitySnapshotId = String(context?.snapshotId ?? 'unknown-snapshot');
    const argumentHash = sha256Hex(canonicalJson(proposal.arguments ?? {}));
    /** @type {number[]} */
    const seqs = [];
    const record = async (/** @type {string} */ type, /** @type {Record<string, unknown>} */ fields = {}) => {
      const event = await journal.append(type, { runId, ...fields });
      seqs.push(event.seq);
      return event;
    };

    // ---- authority -----------------------------------------------------------
    let permit;
    try {
      permit = authority.issue({
        policyDecision: policyDecision.decision,
        runId,
        actorId,
        workspaceId,
        capability: capabilityId,
        capabilityVersion: capability.version,
        capabilitySnapshotId,
        risk,
        proposalHash,
        argumentHash,
        confirmationId
      });
    } catch (err) {
      await record(EVENT.DENIED, {
        proposalId: String(proposal.proposalId ?? ''),
        proposalHash,
        capability: capabilityId,
        risk,
        data: { stage: 'authority', code: codeOf(err), detail: messageOrNothing(err) }
      });
      return buildResult({
        runId,
        turn,
        status: STATUS.DENIED,
        message: `no authority was issued: ${messageOrNothing(err)}`,
        seqs,
        startedAt: Date.now(),
        proposal,
        capability: capabilityId,
        risk,
        policyDecision
      });
    }

    await record(EVENT.AUTHORIZED, {
      proposalId: String(proposal.proposalId ?? ''),
      proposalHash,
      capability: capabilityId,
      risk,
      permitId: permit.permitId,
      data: {
        confirmationId: confirmationId ?? null,
        originRunId,
        actorId,
        workspaceId,
        capabilityVersion: capability.version,
        capabilitySnapshotId,
        argumentHash,
        expiresAt: new Date(permit.expiresAt).toISOString()
      }
    });

    const consumed = authority.consume({
      permitId: permit.permitId,
      runId,
      actorId,
      workspaceId,
      capability: capabilityId,
      capabilityVersion: capability.version,
      capabilitySnapshotId,
      proposalHash,
      argumentHash
    });
    if (consumed.ok === false) {
      await record(EVENT.DENIED, {
        proposalId: String(proposal.proposalId ?? ''),
        proposalHash,
        capability: capabilityId,
        risk,
        permitId: permit.permitId,
        data: { stage: 'authority-consume', code: consumed.code, detail: consumed.detail }
      });
      return buildResult({
        runId,
        turn,
        status: STATUS.DENIED,
        message: `authority refused at consumption: ${consumed.detail}`,
        seqs,
        startedAt: Date.now(),
        proposal,
        capability: capabilityId,
        risk,
        policyDecision,
        permitId: permit.permitId
      });
    }

    await record(EVENT.AUTHORITY_CONSUMED, {
      proposalId: String(proposal.proposalId ?? ''),
      proposalHash,
      capability: capabilityId,
      risk,
      permitId: permit.permitId,
      data: {}
    });

    // ---- execution -----------------------------------------------------------
    await record(EVENT.EXECUTION_STARTED, {
      proposalId: String(proposal.proposalId ?? ''),
      proposalHash,
      capability: capabilityId,
      risk,
      permitId: permit.permitId,
      data: { adapter: capability.adapter.kind }
    });

    const args = /** @type {Record<string, unknown>} */ (proposal.arguments);
    const executionStart = Date.now();
    /** @type {{ ok: boolean, code?: string, detail?: string, data?: Record<string, unknown> }} */
    let outcome;
    try {
      if (capability.adapter.kind === 'mock') {
        outcome = /** @type {any} */ (
          adapters.mock.execute({ capability, operation: String(capability.adapter.operation), arguments: args })
        );
      } else {
        outcome = /** @type {any} */ (
          await adapters.http.execute({
            capability,
            bindingId: String(capability.adapter.binding),
            arguments: args
          })
        );
      }
    } catch (err) {
      outcome = { ok: false, code: codeOf(err), detail: messageOf(err) };
    }
    const executionMs = Date.now() - executionStart;

    if (outcome.ok !== true) {
      // Commit certainty decides the terminal status. An ambiguous mutation is NEVER reported as
      // a plain failure (it may have applied) and is NEVER retried automatically.
      if (/** @type {{ commitState?: string }} */ (outcome).commitState === 'UNKNOWN') {
        await record(EVENT.COMMIT_UNKNOWN, {
          proposalId: String(proposal.proposalId ?? ''),
          proposalHash,
          capability: capabilityId,
          risk,
          permitId: permit.permitId,
          data: {
            code: outcome.code ?? CODES.COMMIT_UNKNOWN,
            detail: outcome.detail ?? 'transport certainty lost',
            commitState: 'UNKNOWN',
            idempotency: capability.idempotency,
            nextStep:
              'do not retry; re-read the affected state with a READ capability, then escalate to the operator with this run id'
          }
        });
        return buildResult({
          runId,
          turn,
          status: STATUS.COMMIT_UNKNOWN,
          message: `${capabilityId}: the request may or may not have reached the application (${outcome.detail ?? outcome.code ?? 'transport certainty lost'}). It was not retried. Reconcile before acting.`,
          seqs,
          startedAt: Date.now(),
          proposal,
          capability: capabilityId,
          risk,
          policyDecision,
          permitId: permit.permitId,
          execution: { ok: false, code: outcome.code, detail: outcome.detail, commitState: 'UNKNOWN' }
        });
      }
      await record(EVENT.EXECUTION_FAILED, {
        proposalId: String(proposal.proposalId ?? ''),
        proposalHash,
        capability: capabilityId,
        risk,
        permitId: permit.permitId,
        data: { code: outcome.code ?? 'ADAPTER_ERROR', detail: outcome.detail ?? 'no detail', commitState: 'NOT_SENT' }
      });
      return buildResult({
        runId,
        turn,
        status: STATUS.EXECUTION_FAILED,
        message: `${capabilityId} failed: ${outcome.detail ?? outcome.code ?? 'unknown adapter failure'}`,
        seqs,
        startedAt: Date.now(),
        proposal,
        capability: capabilityId,
        risk,
        policyDecision,
        permitId: permit.permitId,
        execution: { ok: false, code: outcome.code, detail: outcome.detail }
      });
    }

    await record(EVENT.EXECUTION_SUCCEEDED, {
      proposalId: String(proposal.proposalId ?? ''),
      proposalHash,
      capability: capabilityId,
      risk,
      permitId: permit.permitId,
      data: {
        toolResult: toolResultFor(capability, outcome.data ?? {}),
        adapter: capability.adapter.kind,
        idempotency: capability.idempotency
      }
    });

    // ---- verification --------------------------------------------------------
    const verificationStart = Date.now();
    const verification = verifiers.run({
      verifierId: capability.verifier,
      capability,
      proposal,
      arguments: args,
      execution: { ok: true, ...(outcome.data ? { data: outcome.data } : {}) }
    });
    const verificationMs = Date.now() - verificationStart;

    if (!verification.passed) {
      await record(EVENT.VERIFICATION_FAILED, {
        proposalId: String(proposal.proposalId ?? ''),
        proposalHash,
        capability: capabilityId,
        risk,
        permitId: permit.permitId,
        data: {
          verifier: capability.verifier,
          checks: verification.checks,
          executionDataDigest: digest(outcome.data ?? {})
        }
      });
      return buildResult({
        runId,
        turn,
        status: STATUS.VERIFICATION_FAILED,
        message: `${capabilityId} ran but could not be verified; treat the effect as unconfirmed`,
        seqs,
        startedAt: Date.now(),
        proposal,
        capability: capabilityId,
        risk,
        policyDecision,
        permitId: permit.permitId,
        execution: { ok: true, ...(outcome.data ? { data: outcome.data } : {}) },
        verification
      });
    }

    await record(EVENT.VERIFIED, {
      proposalId: String(proposal.proposalId ?? ''),
      proposalHash,
      capability: capabilityId,
      risk,
      permitId: permit.permitId,
      data: { verifier: capability.verifier, checks: verification.checks, executionDataDigest: digest(outcome.data ?? {}) }
    });

    return buildResult({
      runId,
      turn,
      status: STATUS.EXECUTED_VERIFIED,
      message: `${capabilityId} executed and verified`,
      seqs,
      startedAt: Date.now(),
      proposal,
      capability: capabilityId,
      risk,
      policyDecision,
      permitId: permit.permitId,
      execution: { ok: true, ...(outcome.data ? { data: outcome.data } : {}) },
      verification,
      timings: { executionMs, verificationMs }
    });
  }

  /**
   * @param {unknown} err
   * @param {{ runId: string, seqs: number[], startedAt: number }} ctx
   * @returns {Promise<HarnessResult>}
   */
  async function failureResult(err, ctx) {
    const code = codeOf(err);
    if (err instanceof EvidenceError || code === CODES.EVIDENCE_WRITE_FAILED) {
      return buildResult({
        runId: ctx.runId,
        turn,
        status: STATUS.EVIDENCE_ERROR,
        message: `evidence could not be written, so the action was not allowed to proceed: ${messageOf(err)}`,
        seqs: ctx.seqs,
        startedAt: ctx.startedAt,
        policyDecision: null
      });
    }
    // Unknown internal failure: fail closed, and say so plainly rather than guessing.
    return buildResult({
      runId: ctx.runId,
      turn,
      status: STATUS.EXECUTION_FAILED,
      message: `internal failure (${code}): ${messageOf(err)}`,
      seqs: ctx.seqs,
      startedAt: ctx.startedAt,
      policyDecision: null
    });
  }

  /**
   * @param {{ runId: string, turn?: number, status: string, message?: string, proposal?: any, capability?: any, risk?: any, policyDecision?: any, permitId?: any, confirmation?: any, execution?: any, verification?: any, seqs?: number[], providerMs?: number, timings?: any, diagnostics?: any, startedAt?: number }} input
   * @returns {HarnessResult}
   */
  function buildResult(input) {
    const startedAt = typeof input.startedAt === 'number' ? input.startedAt : Date.now();
    return {
      runId: String(input.runId),
      turn: Number(input.turn ?? turn),
      status: String(input.status),
      message: String(input.message ?? ''),
      proposal: /** @type {Record<string, unknown>|null} */ (input.proposal ?? null),
      capability: /** @type {string|null} */ (input.capability ?? null),
      risk: /** @type {string|null} */ (input.risk ?? null),
      policyDecision: /** @type {Record<string, unknown>|null} */ (input.policyDecision ?? null),
      permitId: /** @type {string|null} */ (input.permitId ?? null),
      confirmation: /** @type {any} */ (input.confirmation ?? null),
      execution: /** @type {any} */ (input.execution ?? null),
      verification: /** @type {any} */ (input.verification ?? null),
      evidence: { seqs: /** @type {number[]} */ (input.seqs ?? []), lastSeq: journal.lastSeq() },
      timingsMs: {
        total: Date.now() - startedAt,
        provider: Number(input.providerMs ?? 0),
        ...(/** @type {any} */ (input.timings) ?? {})
      },
      ...(input.diagnostics ? { diagnostics: /** @type {any} */ (input.diagnostics) } : {})
    };
  }
}

/**
 * The envelope schema passed to the runtime as a `format`/`response_format` constraint. It is the
 * all-fields-required form, because a grammar can only enforce what the schema requires.
 * @returns {Record<string, unknown>}
 */
function envelopeFormatSchema() {
  return ENVELOPE_FORMAT_SCHEMA;
}

/**
 * Normalize the identifier the model supplied. It is audit bookkeeping, not authority: the
 * canonical proposal hash is what permits bind to. An id that sanitises to nothing, or a model
 * that supplies none, yields a stable hash-derived id, so a small model is never failed for
 * bookkeeping it should not have to do (evidence: LIVE_MODEL_VALIDATION.md, first live run).
 * @param {string} raw
 * @param {string} capability
 * @param {Record<string, unknown>} args
 * @returns {string}
 */
function normalizeProposalId(raw, capability, args) {
  const sanitized = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (sanitized.length > 0) return sanitized;
  return `p-${hashAction(capability, args).slice(0, 12)}`;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
function digest(data) {
  return sha256Hex(JSON.stringify(data)).slice(0, 16);
}

/**
 * A privacy-minimal summary of a tool result for the evidence journal: identifiers, a count,
 * a digest and one bounded line. Wholesale customer or financial payloads are never copied
 * into evidence (directive: evidence should prefer ids/hashes/safe summaries).
 * @param {import('./registry/capability.mjs').Capability} capability
 * @param {Record<string, unknown>} data
 * @returns {Record<string, unknown>}
 */
function toolResultFor(capability, data) {
  /** @type {Record<string, unknown>} */
  const ids = {};
  for (const key of ['customerId', 'invoiceId', 'journalId', 'ledgerEntryId', 'entryId']) {
    const value = data[key];
    if (typeof value === 'string') ids[key] = value;
  }
  const idSummary = Object.entries(ids)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
  return {
    capabilityId: capability.id,
    status: 'SUCCESS',
    ids,
    count: typeof data.count === 'number' ? data.count : null,
    digest: digest(data),
    summary: `${capability.id} succeeded${idSummary.length > 0 ? ` (${idSummary})` : ''}`.slice(0, 240)
  };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function messageOrNothing(err) {
  if (err instanceof AuthorityError || err instanceof PolicyError || err instanceof ProposalError || err instanceof ProviderError) {
    return err.message;
  }
  return messageOf(err);
}
