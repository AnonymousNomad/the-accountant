# High-Impact Operation — FINANCIAL Actions Under Confirmation

## Objective
Run FINANCIAL (and any confirmation-required) operations: preview first, state the exact effect in plain
language, wait for confirmation bound to the exact arguments, never re-issue while one is pending, and
handle decline and expiry correctly.

## Prerequisites
- `invoice.issue` (FINANCIAL, `requiresConfirmation: true`) exposed for the turn; its prerequisite
  (`invoice.has_draft`) satisfied; `invoice.preview` available for the preview and any re-read.
- `confirmation.ttlSeconds` and `authority.permitTtlSeconds` known from validated config.
- The operator understands that confirmation is an INPUT into trusted permit issuance — it is not
  authority, and it does not bypass policy, verification, or evidence.

## Procedure
1. Preview first: propose `invoice.preview` for the target `INV-nnnn` and read the verified status, lines,
   and stored total. Never issue a draft that has not been seen (capability metadata: do not use before
   previewing a draft you have not seen).
2. State the exact effect in plain language before proposing: "invoice INV-0007 will move DRAFT to ISSUED;
   this is irreversible, and it posts a ledger entry for the invoice total." Use the stored total from
   verification; never compute totals, tax, or balances.
3. Propose exactly one `invoice.issue` with `{ "invoiceId": "INV-nnnn" }` and a fresh `proposalId`; the
   harness freezes the proposal, decides `CONFIRMATION_REQUIRED`, and arms a confirmation bound to the
   proposal hash and this turn.
4. Present the frozen proposal exactly as it will execute — capability, arguments, risk class, hash — and
   ask for yes/no. Do not paraphrase it, do not soften it, and do not treat earlier intent as consent.
5. Wait. Only a `yes` or `no` in the immediately following input resolves the pending confirmation; any
   other instruction abandons and invalidates it (F-15). Do not re-issue, re-word, or pre-approve while
   one is pending: a second proposal would arm a second path to the same one-way effect.
6. On `yes`, the harness issues a one-use permit bound to the proposal hash and consumes it immediately
   before execution (I-2, I-3). You do not hold, grant, or interpret authority.
7. On `no`, the run ends in `CONFIRMATION_REJECTED` with nothing executed; say exactly that, and do not
   propose a variant to work around the decline.
8. On expiry (past `confirmation.ttlSeconds` or `permitTtlSeconds`), the confirmation and permit are dead;
   a late yes is rejected and nothing executes. Never extend a TTL or re-arm a confirmation to make a late
   answer fit.
9. After execution, require `VERIFIED` (`invoice.issued`: invoice_exists, status_is_issued,
   issued_at_recorded, ledger_entry_present, ledger_entry_matches_total,
   reported_ledger_entry_matches_store) before reporting success; otherwise report
   `EXECUTION_FAILED`/`VERIFICATION_FAILED` exactly, and follow the COMMIT_UNKNOWN procedure when the
   transport outcome is uncertain.

## Gates
- G1: no FINANCIAL capability executes without a matching `CONFIRMATION_GRANTED` (resident flow gate G2).
- G2: the object executed is byte-identical (canonical hash equal) to the object shown at confirmation.
- G3: at most one live confirmation per proposal hash; no second proposal for the same effect while one
  is pending.
- G4: the ledger effect checked by the verifier is the ledger effect reported to the user.

## Expected evidence
- `CONFIRMATION_REQUIRED`, then `CONFIRMATION_GRANTED` or `CONFIRMATION_REJECTED`; `AUTHORIZED` with the
  permit; `AUTHORITY_CONSUMED`; `EXECUTION_STARTED`; `EXECUTION_SUCCEEDED`; `VERIFIED` with the six checks
  and the ledger entry id.
- `:evidence` for the full slice; for the one-shot operator path,
  `node src/cli.mjs --provider ollama --prompt "issue invoice INV-0007" --confirm`.

## Failure conditions
- A second proposal issued while a confirmation is pending: process failure; stop and let the armed
  confirmation resolve or expire.
- The action described as done before `VERIFIED`: false claim; report the real status immediately.
- Totals computed by the model, a TTL extended, or consent inferred from context: process failure.
- Adapter failure or a partial effect: `EXECUTION_FAILED`/`VERIFICATION_FAILED`, never success.

## Recovery / rollback
- `invoice.issue` is one-way (DRAFT to ISSUED); a rejected, expired, or failed turn leaves the draft
  intact and is recovered by a fresh instruction, a fresh proposal, and fresh confirmation.
- A partial or uncertain effect is never retried; an operator-reviewed compensating action may be
  required, recorded in evidence as a human decision.
- Restart the session to discard pending confirmations and permits; no authority survives restart.

## Completion criteria
- Every FINANCIAL turn is explained by its confirmation, permit, execution, and verification events; only
  `EXECUTED_VERIFIED` with all six checks passing is described as success.
