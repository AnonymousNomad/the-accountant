# Ambiguous Commit Recovery — The COMMIT_UNKNOWN State

## Objective
Define the COMMIT_UNKNOWN procedure: the request may or may not have reached the application and
transport certainty was lost. Stop, do not retry, do not claim success or failure, reconcile by
re-reading state with a READ capability, and escalate with the correlation id.

## Prerequisites
- The run has `EXECUTION_STARTED` and no definitive adapter outcome: a timeout after the request was
  sent, a connection reset mid-response, an ambiguous 2xx or body, or an error that cannot distinguish
  "did not arrive" from "arrived with no response".
- The capability's declared idempotency class is known (`naturally_idempotent`,
  `idempotency_key_supported`, `non_idempotent`); retry safety is never inferred from the HTTP method or
  anything else.
- The correlation identifiers are available: `runId`, `proposalId`, `proposalHash`, `permitId`,
  `snapshotId`, and the adapter's diagnostic code.

## Procedure
1. Stop the turn. Do not retry, do not re-propose, and do not issue a second permit: the outcome is
   unknown and a retry can double the effect.
2. Do not claim success and do not claim failure. The state is exactly COMMIT_UNKNOWN: a distinct,
   mandatory terminal status for this run.
3. Record the state with its correlation identifiers and the adapter diagnostic: capability,
   `proposalHash`, `permitId` (if consumed), the error code, and the snapshot identity. Never journal a
   raw response body that may contain attacker text; record its shape and diagnostic only.
4. Reconcile by re-reading authoritative state with a READ capability, chosen per the effect:
   `invoice.preview` after an `invoice.issue`; `customer.search` after customer operations; `ledger.query`
   for ledger effects. The re-read is the trusted fact; the adapter's uncertainty is not.
5. Report the re-read as what it is: "invoice INV-0007 is DRAFT" or "is ISSUED". Do not rewrite the
   original run's status: it remains COMMIT_UNKNOWN unless verification of that execution completes. A
   re-read establishes present state; it does not retroactively verify the commit.
6. Never issue a fresh attempt for the same effect while the outcome is unknown. If the re-read shows no
   effect and the operator wants the action, that is a new instruction, a new proposal, a new permit, and
   new confirmation — an operator decision, recorded.
7. Escalate to the operator with the correlation id and the re-read result, so the application side can be
   inspected using the same identifiers. Include the idempotency class so the operator knows what the
   adapter contract permits.
8. Leave evidence: the run's full slice — proposal, decision, `AUTHORIZED`, `AUTHORITY_CONSUMED` (if
   consumed), `EXECUTION_STARTED`, the COMMIT_UNKNOWN record, and any reconciliation reads with their
   `VERIFIED` results.
9. If the COMMIT_UNKNOWN record cannot be written, fail closed: no further execution, a non-zero exit, and
   the storage fault reported; an unrecorded ambiguous commit is an incident.

## Gates
- G1: exactly one COMMIT_UNKNOWN record per ambiguous run, carrying the correlation id.
- G2: no retry, no re-proposal, and no second permit for the same effect while the state stands.
- G3: neither success nor failure language appears for the run.
- G4: a reconciliation read is attempted and its outcome recorded (including when the read fails).

## Expected evidence
- `EXECUTION_STARTED` then the COMMIT_UNKNOWN record with the adapter code and identifiers; the
  reconciliation read's `VERIFIED` (or its failure) in a separate run.
- `:evidence` for both runs; `:verify-chain` to confirm the record chain; the CLI exit code is non-zero
  for the ambiguous run.

## Failure conditions
- A retry after an ambiguous commit: process failure; stop, record, and treat any resulting duplicate as
  an incident requiring operator compensation.
- A success or failure claim: false fact; correct the transcript and log the process failure.
- No correlation id in the record, or no reconciliation attempt: SOP violation.
- Jeopardising the evidence record (rewriting, truncating, deleting): chain breakage per F-27.

## Recovery / rollback
- The operator inspects the application side with the correlation id, then decides: accept the re-read
  state, run a fresh action with new authority, or compensate — a recorded human decision.
- Restart the session to discard permits and confirmations; authority never persists across restart.
- Keep the ambiguous run's evidence for post-mortem; do not clean it up.

## Completion criteria
- The ambiguous run is recorded as COMMIT_UNKNOWN with its correlation id, never described as success or
  failure, never retried automatically, and reconciled by a verified read or an operator escalation.
