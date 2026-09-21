# Execution Verification — Executed Is a Claim, Verified Is a Fact

## Objective
State the difference between executed and verified, define what the verifier checks, and define what the
user is told when verification fails.

## Prerequisites
- The capability has a registered verifier; registration without one fails at build time (I-10, F-25).
- `EXECUTION_SUCCEEDED` exists for the run; the proposal and arguments are the ones authorized.
- The domain store is deterministic, so a re-executed read is a real check, not a replay.

## Procedure
1. After the permit is consumed and the adapter returns, label the adapter result exactly as it is: a
   claim. `EXECUTION_SUCCEEDED` in the journal means the adapter returned; it is not verification.
2. Invoke the capability's registered verifier against domain state; never inspect the adapter's return
   value as evidence and never skip verification because the claim looks plausible.
3. Read the verifier's checks as the definition of "verified":
   - `customer.created`: customer_exists, name_matches, email_matches.
   - `customer.updated`: customer_exists, version_incremented, reported_version_matches_store, plus the
     name/email checks for fields that changed.
   - `invoice.drafted`: invoice_exists, status_is_draft, customer_matches, total_matches_lines,
     reported_total_matches_store.
   - `invoice.issued`: invoice_exists, status_is_issued, issued_at_recorded, ledger_entry_present,
     ledger_entry_matches_total, reported_ledger_entry_matches_store.
   - `journal.proposed`: journal_exists, status_is_draft, balanced, memo_matches, date_matches.
   - `read.matches_result`: read_reproduced, result_shape (the same deterministic read re-executed).
4. Only when every check passes may the status be `VERIFIED` and then `EXECUTED_VERIFIED` (I-6). Any
   failing check, or a verifier that throws, produces `VERIFICATION_FAILED` (F-22, F-24) — fail closed.
5. Tell the user exactly this on success: what was verified, against synthetic domain state, with the
   identifier and the stored values the checks compared. Nothing stronger.
6. Tell the user exactly this on failure: the action may have partly landed, verification did not pass,
   and these checks failed. Never call it a success, never say "nothing happened", and never retry
   automatically — an effect may exist.
7. Never suppress a failing check, downgrade it, or re-verify until it passes. The verifier's checks are
   the record.
8. If the outcome of execution is uncertain at the transport level, do not run any success/failure
   narrative: follow the COMMIT_UNKNOWN procedure.
9. If verification itself cannot be recorded (evidence write failure), keep the failure status, let the
   CLI exit non-zero, and stop; an unrecorded verification is not a verification.

## Gates
- G1: `EXECUTED_VERIFIED` is reachable only via `VERIFIED`; `VERIFICATION_FAILED` only via failed checks
  (I-6).
- G2: no success claim for any run whose last lifecycle event is not `VERIFIED`.
- G3: the checks reported to the user are the checks recorded in the journal, unmodified.
- G4: no automatic retry of a failed or unverified action anywhere in the turn.

## Expected evidence
- `EXECUTION_SUCCEEDED` then `VERIFIED` or `VERIFICATION_FAILED` with per-check results, ids, and statuses
  in redacted data; `:evidence` shows both events; `:verify-chain` confirms the chain.
- `npm test` and `npm run verify` are the project's own gate commands; their output is the evidence, and
  no transcript may state their result in advance.

## Failure conditions
- Reporting `EXECUTION_SUCCEEDED` as success: false fact; correct the record and log the process failure.
- Treating a missing verifier as a pass: forbidden; a capability without a verifier cannot be registered.
- A verifier exception swallowed into a pass: defect; stop and escalate.
- A failed verification converted into a success-shaped message: process failure by definition.

## Recovery / rollback
- Investigate by reading state with a READ capability; the re-read establishes what actually exists.
- A compensating action is an operator decision, journaled as such; the harness does not invent one.
- Fix verifier defects in code and re-run the project's gates; keep the failed run's evidence intact.

## Completion criteria
- Every run's status matches its last lifecycle event (I-5); only an all-checks-passed verification is
  described as success, and every failure is described with its failing checks.
