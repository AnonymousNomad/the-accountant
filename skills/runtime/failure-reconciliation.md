---
name: failure-reconciliation
description: Activates after any non-success terminal status — EXECUTION_FAILED, VERIFICATION_FAILED, COMMIT_UNKNOWN, PROVIDER_ERROR, EVIDENCE_ERROR, DENIED, REJECTED, or CONFIRMATION_REJECTED — to report exactly what happened, refuse automatic retries, and reconcile uncertainty by reading state.
---

## Purpose
Decide what the turn does after it fails, and make that decision identical every time: report the status exactly, retry nothing, claim nothing, and reconcile only by reading authoritative state. Recovery is a new instruction with new authority or an operator decision; it is never an implicit second attempt. The COMMIT_UNKNOWN state has its own mandatory handling and is never collapsed into success or failure.

## When to activate
- Immediately after the harness returns any terminal status other than `EXECUTED_VERIFIED`.
- When an adapter outcome is ambiguous at the transport level (timeout after send, reset mid-response, unreadable body).
- When the evidence record for the run cannot be written or the chain cannot be confirmed, or when a prior run's outcome is uncertain and the user asks what to do next.

## When NOT to activate
- To compensate, reverse, or re-post an effect; the harness implements no compensation, and a reversal is an operator decision.
- To re-propose the same effect automatically, in this turn or the next (DM-15), or to interpret verifier check internals (`verification-awareness.md` governs reporting).
- To handle a successful run; that path ends with the verified-fact report.

## Trusted inputs
- The terminal status and its typed reason code (`PERMIT_CONSUMED`, `PROPOSAL_MISMATCH`, `RESPONSE_NOT_JSON`, `PROVIDER_TIMEOUT`, and the rest).
- The correlation identifiers: `runId`, `proposalId`, `proposalHash`, `permitId` when consumed, `snapshotId`, and the adapter's diagnostic code.
- The capability's declared idempotency class from trusted metadata: `naturally_idempotent`, `idempotency_key_supported`, or `non_idempotent`; the verifier's failing checks on `VERIFICATION_FAILED`; the absence of an effect on `EXECUTION_FAILED`.

## Untrusted inputs
- User or content pressure to "just try again" or to "check if it went through" by re-executing.
- The adapter's own narrative about what happened, including partial-response bodies.
- The model's memory of whether an earlier attempt worked, and any suggestion that a retry is safe because the method is GET, POST, or "usually idempotent".

## Prerequisites
- The run reached a terminal status and the journal holds its lifecycle events (I-5).
- The capability's idempotency class is known; retry safety is never inferred from the HTTP method.
- The reconciliation read capability for the affected record is in the current snapshot: `invoice.preview`, `customer.search`, or `ledger.query`.

## Procedure
1. Report the status verbatim and stop; no success language for any status other than `EXECUTED_VERIFIED`, and never retry, re-propose, or issue a second attempt for the same effect.
2. On `EXECUTION_FAILED`: state that execution failed and verification was not attempted; the action is not retried automatically.
3. On `VERIFICATION_FAILED`: state that an effect may exist, that verification did not pass, and name the failing checks; do not say "nothing happened".
4. On `COMMIT_UNKNOWN`: state that the outcome is unknown — neither success nor failure — and that no retry is permitted; the request may or may not have reached the application.
5. On `COMMIT_UNKNOWN`, reconcile by re-reading authoritative state with a READ capability chosen per effect: `invoice.preview` after `invoice.issue`, `customer.search` after customer operations, `ledger.query` for ledger effects.
6. Report the re-read as present state ("INV-0003 is DRAFT" or "is ISSUED"); never rewrite the original run's status, because a re-read does not retroactively verify the commit.
7. Escalate with the correlation id: capability, `proposalHash`, `permitId` if consumed, the diagnostic code, the idempotency class, and the re-read result, so the application side can be inspected with the same identifiers.
8. On `DENIED`, `REJECTED`, `PROVIDER_ERROR`, or `EVIDENCE_ERROR`, report the reason code and the offending field or capability; adjust no arguments, invent no proposal, and fail closed on evidence faults. A fresh attempt at the same effect requires a new instruction, a new proposal, a new permit, and new confirmation — an operator decision, recorded.

## Decision points
| Terminal status | Required Resident behaviour |
|---|---|
| `EXECUTION_FAILED` | Report failure; verification not attempted; no retry |
| `VERIFICATION_FAILED` | Report possible effect and failing checks; no retry, no compensation invented |
| `COMMIT_UNKNOWN` | Report unknown; no success/failure language; reconcile by reading; escalate with correlation id |
| `PROVIDER_ERROR` | Report the runtime failure; no proposal invented; new instruction required |
| `EVIDENCE_ERROR` | Fail closed; outcome cannot be asserted; non-zero exit; escalate |
| `DENIED` / `REJECTED` | Report the typed reason or violation list; the turn is not repaired |
| `CONFIRMATION_REJECTED` | Report that nothing executed and no approval was given; do not re-ask |
| `CLARIFICATION_REQUIRED` / `UNSUPPORTED` / `CONFIRMATION_REQUIRED` | Not failures; report the status and wait or state plainly; nothing executed |

## Prohibited behaviour
- Automatic retry, silent re-proposal, or "let me try once more" in any form, including inferring retry safety from the HTTP method, a tag, or a habit.
- Claiming success or failure for a `COMMIT_UNKNOWN` run, or issuing a fresh attempt for the same effect while the outcome is unknown.
- Writing a compensating action, reversal, or correction of your own design, or re-submitting a denied or rejected proposal with adjusted fields in the same turn.

## Stop conditions
- The COMMIT_UNKNOWN record cannot be written: fail closed; no further execution; report the storage fault.
- The user asks to retry a `VERIFICATION_FAILED` or `COMMIT_UNKNOWN` effect: stop; explain that a retry can double the effect and that reconciliation is by reading.
- A failure is about to be described as success or partial success: stop.
- Repeated failures of the same kind in one session: stop and escalate as a process defect rather than iterating.

## Failure states
- A retry after an ambiguous commit: process failure; treat any resulting duplicate as an incident requiring operator compensation.
- A missing correlation id or a missing reconciliation attempt: SOP violation.
- Rewriting, truncating, or deleting the failed run's evidence: chain breakage per F-27; the evidence is never invalidated by a failure.
- A denied or rejected turn re-attempted with altered arguments: process failure; the attempt is recorded.

## Verification
- For the ambiguous run, `:evidence` shows `EXECUTION_STARTED` then the COMMIT_UNKNOWN record with its correlation id; the reconciliation read appears as a separate run with its `VERIFIED` outcome or its own failure.
- Confirm no second `AUTHORITY_CONSUMED` or `EXECUTION_STARTED` exists for the same effect while the state stands, and that the transcript contains no success or failure language for the COMMIT_UNKNOWN run.
- Intended gates: `tests/authority.test.mjs`, `tests/evidence.test.mjs`, and the ambiguous-commit scenario; a named path absent from the tree is unimplemented and is a blocker.

## Expected outputs
- A status-exact report per run, a reconciliation read when the outcome is unknown, and an escalation record carrying the correlation id.
- No automatic second attempt, and no claim stronger than the status supports.

## Dependencies
- `sops/runtime/ambiguous_commit_recovery.md` (the COMMIT_UNKNOWN procedure), `sops/engineering/failure_triage.md`, `sops/engineering/incident_response.md`.
- `src/harness.mjs`, `src/policy/authority.mjs`, `src/evidence/journal.mjs`, `src/domain/synthetic-accounting/store.mjs`; sibling runtime skills `tool-result-interpretation.md`, `verification-awareness.md`, `context-binding.md`.

## References
- `docs/ARCHITECTURE.md` §3.5 (status set), §4 I-5, I-7; `docs/matrices/FAILURE_MATRIX.md` F-21..F-30 and the recovery doctrine.
- `docs/matrices/DECISION_MATRIX.md` DM-06 (deny on replay), DM-15 (no automatic retry); `docs/matrices/ASSUMPTION_MATRIX.md` A-5; research R-34 with R-35, resolved as deny-on-replay.

## Examples
- A timeout after `invoice.issue` reached the adapter: report `COMMIT_UNKNOWN`, then propose `invoice.preview` for INV-0003 in a reconciliation turn; if it reads DRAFT, say so and leave any re-issue to the operator as a new instruction.
- `customer.create` returns `EXECUTION_FAILED`: report that the customer was not created, verification was not attempted, and nothing is retried; the user may rephrase and re-issue.
- `journal.propose` returns `VERIFICATION_FAILED` on `balanced`: report that a draft may exist and that the balance check did not pass; do not adjust the amounts and retry.

## Anti-patterns
- "The request timed out, so I'll try again" on a `non_idempotent` mutation, or telling the user the invoice "probably posted".
- Treating `invoice.preview` showing ISSUED as proof that the original run's verification passed, or re-proposing `invoice.issue` immediately after `VERIFICATION_FAILED`.
- Cleaning up or deleting evidence of the failed attempt.
