# Mutation Operation — Preview, Propose, Verify, Report

## Objective
Run MUTATION and DRAFT capabilities with a preview, an exact proposal, the harness's policy decision,
mandatory post-execution verification, and an exact report of what changed — including the identifier.

## Prerequisites
- For this turn's snapshot: `customer.create` and `customer.update` (MUTATION);
  `invoice.create_draft` and `journal.propose` (DRAFT).
- Required arguments known per schema; identifiers resolved (entity resolution) — no guessed ids.
- The capability's declared idempotency class is read from trusted metadata; retry safety is never
  inferred from the HTTP method or anything else.

## Procedure
1. Preview first where a read exists: `invoice.preview` before acting on an invoice; `customer.search`
   before `customer.create`; `ledger.query` to see what exists before `journal.propose`.
2. Build arguments exactly from stated or verified values: `name`/`email` for customer operations;
   `customerId` plus `lines` (description, quantity, unitPriceCents) for a draft invoice; `memo`, `date`,
   and lines with `account`/`debitCents`/`creditCents` for a journal proposal. Never compute totals,
   balances, or tax — the domain owns that arithmetic and the verifier checks it.
3. Propose exactly one capability with a fresh `proposalId`; do not predict the policy decision and do not
   describe the change as done.
4. Let policy decide (`ALLOW`, `CONFIRMATION_REQUIRED`, `DENY`). If confirmation is required, switch to
   the high-impact procedure; an allowed mutation executes only after a permit is consumed for this exact
   proposal hash (I-1, I-2).
5. After execution, require the registered verifier's result before saying anything happened:
   `customer.created` (customer_exists, name_matches, email_matches); `customer.updated`
   (customer_exists, version_incremented, reported_version_matches_store); `invoice.drafted`
   (invoice_exists, status_is_draft, customer_matches, total_matches_lines, reported_total_matches_store);
   `journal.proposed` (journal_exists, status_is_draft, balanced, memo_matches, date_matches).
6. Report exactly what changed, with the id, quoting verified stored values: "customer CUS-0012 created
   (version 1)"; "invoice INV-0007 drafted, status DRAFT, total as stored 145000 cents"; "journal entry
   JRN-0003 drafted, DRAFT, balanced". Never report adapter-claimed values the verifier did not confirm.
7. On a failed or unverified execution, report the failure exactly (`EXECUTION_FAILED` or
   `VERIFICATION_FAILED`), never as success, and never retry automatically — an effect may exist.
8. If the transport outcome is uncertain, stop and follow the COMMIT_UNKNOWN procedure; do not re-issue
   the mutation under a new proposal while the outcome is unknown.

## Gates
- G1: no mutation executes without a consumed permit for its exact proposal hash (I-1, I-2).
- G2: the executed object is byte-identical (canonical hash equal) to the proposed object (I-3).
- G3: no `EXECUTED_VERIFIED` without `VERIFIED`; every reported value is a stored value (I-6).
- G4: no domain arithmetic (totals, balances, tax, versions) performed by the model anywhere in the turn.

## Expected evidence
- `PROPOSED`, `POLICY_DECISION`, `AUTHORIZED`, `AUTHORITY_CONSUMED`, `EXECUTION_STARTED`,
  `EXECUTION_SUCCEEDED`, `VERIFIED` with check results, and the new id in redacted data.
- `:evidence` for the slice; `npm run demo` for the scripted end-to-end transcript when demonstrating.

## Failure conditions
- Adapter failure: `EXECUTION_FAILED` with verification not attempted; report the code, never retry (F-21).
- Partial effect: `VERIFICATION_FAILED` with the failing checks; reported as not verified (F-22).
- An id reported as created without a passing `customer.created`/`invoice.drafted` check: process failure;
  treat the claim as unverified and escalate.

## Recovery / rollback
- Recovery is a new instruction, a new proposal, and new authority; nothing auto-retries (F-21 doctrine).
- A failed mutation leaves prior evidence intact; keep the journal slice and do not rewrite records.
- Compensation for a partial effect is an operator decision, recorded as such — not harness behaviour.

## Completion criteria
- Every mutation ended in a status from the closed set with the last lifecycle event matching (I-5), and
  every success report names the identifier and the verified state that proves it.
