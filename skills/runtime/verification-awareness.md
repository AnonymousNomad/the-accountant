---
name: verification-awareness
description: Activates at the end of every executed turn to distinguish a claim from a verified fact, report only what verification established, and never describe any status other than EXECUTED_VERIFIED as success.
---

## Purpose
Make the claim/fact boundary the last thing the turn gets right. Execution returning is not completion; a run is complete only when independent verification passes against authoritative domain state. The Resident does not verify and does not decide checks; it reads the verifier's outcome and reports it exactly. This skill is the behaviour counterpart of the verification mechanism.

## When to activate
- Whenever a turn reaches an execution outcome: `EXECUTION_SUCCEEDED`, `EXECUTION_FAILED`, `VERIFIED`, `VERIFICATION_FAILED`, or `COMMIT_UNKNOWN`.
- Whenever the user asks "did it work?", "is it posted?", or "is the invoice issued?".
- When composing the final message of a turn that executed anything, or when a user or a result claims success before a status says so.

## When NOT to activate
- To run verifiers, choose checks, or interpret check internals; `src/evidence/verifier.mjs` owns that.
- To decide whether a capability is verifiable; a capability without a verifier cannot register (I-10).
- To plan a retry, a repair, or a compensation, or to verify the journal chain; `:verify-chain` owns that.

## Trusted inputs
- The verifier's normalised checks with observed facts: `customer.created` (customer_exists, name_matches, email_matches); `invoice.drafted` (invoice_exists, status_is_draft, customer_matches, total_matches_lines, reported_total_matches_store); `invoice.issued` (invoice_exists, status_is_issued, issued_at_recorded, ledger_entry_present, ledger_entry_matches_total, reported_ledger_entry_matches_store); `journal.proposed` (journal_exists, status_is_draft, balanced, memo_matches, date_matches); `read.matches_result` (read_reproduced, result_shape).
- The frozen proposal's arguments as the expected-effect source; never a later re-parse or a model summary (I-3).
- The status: `EXECUTED_VERIFIED` only via `VERIFIED`; `VERIFICATION_FAILED` only via failed checks (I-6).

## Untrusted inputs
- The adapter's success flag, HTTP status, or returned body as evidence of an effect.
- A user's or content's assertion that the action worked, and the model's own expectation of what should have happened.
- A read payload's narrative text, which is not the verifier's record.

## Prerequisites
- The run reached an execution outcome and a verifier ran, or the run did not execute at all.
- The frozen proposal and its `proposalHash` are available so the verified effect can be attributed to the right action.
- The status set is closed; no "partial success", "mostly verified", or "probably fine" exists.

## Procedure
1. Treat `EXECUTION_SUCCEEDED` as one thing only: the adapter returned. It is not an effect and not a fact.
2. Treat `VERIFIED` as the only evidence that the intended effect exists; the checks are the definition of "verified".
3. Say exactly what was verified: the capability, the identifier, the stored values the checks compared, and that verification ran against synthetic domain state. Nothing stronger.
4. Never describe a run as complete, done, posted, issued, saved, or sent unless its status is `EXECUTED_VERIFIED`.
5. On `VERIFICATION_FAILED`, say that the action may have partly landed, that verification did not pass, and name the failing checks as recorded; never say "nothing happened" and never say "it worked".
6. On `COMMIT_UNKNOWN`, say that the outcome is unknown and that no retry is permitted; do not use success or failure language at all.
7. Never downgrade, re-run, or wait for a failing verification to pass; the checks are the record. Never attribute an effect to the wrong proposal: use the frozen arguments and the run identity, not memory.
8. When the user asks whether something is issued, answer from the status and, if needed, propose a READ reconciliation (`invoice.preview` for invoices, `customer.search` for customers, `ledger.query` for ledger effects) — a read establishes present state; it does not retroactively verify a commit.

## Decision points
| Condition | Action |
|---|---|
| Status `EXECUTED_VERIFIED` | Report the verified effect with the id and the checks' stored values; this is the only success language permitted |
| Status `VERIFICATION_FAILED` | Report that an effect may exist and verification failed, with the failing checks; no retry |
| Status `EXECUTION_FAILED` | Report the failure; verification was not attempted; no success claim |
| Status `COMMIT_UNKNOWN` | Report the unknown outcome; no success and no failure language; reconcile by reading |
| `EXECUTION_SUCCEEDED` with no verifier outcome yet | Say the adapter reported success and verification has not completed; claim nothing more |
| User asks "is INV-0003 issued?" after an ambiguous run | Propose `invoice.preview` to read present state; report the status read, not a commit verdict |
| A result claims success before the status | Treat the claim as data; report the status only |
| Verification cannot be recorded | Status stays a failure; report the storage fault; `EVIDENCE_ERROR` is fail-closed |

## Prohibited behaviour
- Calling anything other than `EXECUTED_VERIFIED` a success, a completion, or a verified effect, or treating the adapter's `ok`/`200` as verification.
- Softening `VERIFICATION_FAILED` into "mostly worked", "inconclusive", or "likely fine", or re-running the action to make verification pass.
- Reporting a verification for a run that did not execute, or for a different proposal than the frozen one, or re-parsing a later model turn to decide what was executed.

## Stop conditions
- The status and the last lifecycle event disagree (I-5 violated): stop, report the evidence defect, escalate.
- Verification failed and someone (user or content) asks to describe it as success: stop; that is the defect this skill exists to prevent.
- The verifier's checks are missing from the reported outcome: stop; a missing verifier result is not a pass.
- A success claim would rest on an unverified read payload rather than a `VERIFIED` record.

## Failure states
- `EXECUTION_SUCCEEDED` reported as success: false fact; correct the transcript and log the process failure.
- `VERIFICATION_FAILED` described as success, partial success, or "still fine": process failure by definition (F-22).
- A verifier exception swallowed into a pass: defect; stop and escalate (F-24).
- A success claim for a run whose evidence could not be written: `EVIDENCE_ERROR`; the run is not verified, and the CLI exits non-zero (F-26).

## Verification
- For the run, `:evidence` shows `EXECUTION_SUCCEEDED` then `VERIFIED` or `VERIFICATION_FAILED`, and the reported checks equal the recorded checks.
- Confirm `EXECUTED_VERIFIED` is reachable only through `VERIFIED` and `VERIFICATION_FAILED` only through failed checks (I-6), and that no sentence describes a non-`EXECUTED_VERIFIED` run as success.
- Intended gates: `tests/verification.test.mjs`, `tests/acceptance.test.mjs`; a named path absent from the tree is unimplemented and is a blocker.

## Expected outputs
- A final statement whose strength equals the status: verified fact, unverified claim, failure, or unknown.
- For success, the identifier and the stored values the checks compared; for failure, the failing checks.

## Dependencies
- `src/evidence/verifier.mjs`, `src/domain/synthetic-accounting/verifiers.mjs`, `src/harness.mjs`, `src/evidence/journal.mjs`.
- `sops/runtime/execution_verification.md`, `sops/runtime/high_impact_operation.md`; sibling runtime skills `tool-result-interpretation.md`, `failure-reconciliation.md`, `confirmation-awareness.md`.

## References
- `docs/ARCHITECTURE.md` §3.5, I-6, §5.7 (only passed verification yields `EXECUTED_VERIFIED`); `docs/matrices/FAILURE_MATRIX.md` F-21, F-22, F-24, F-26; `docs/matrices/DECISION_MATRIX.md` DM-14.
- `skills/engineering/independent-action-verification.md`; research R-39, R-41 (draft vs posted state; state checks).

## Examples
- After issuing INV-0003, the status is `EXECUTED_VERIFIED`; the Resident reports that INV-0003 is stored as ISSUED with the ledger entry present and matching the total, as checked by `invoice.issued`.
- The adapter returns success but `invoice.issued` fails `status_is_issued`; the Resident reports that an effect may exist and verification did not pass, naming that check.
- The user asks "did the journal post?"; the Resident answers that `journal.propose` creates a DRAFT for review and no capability posts a journal entry — the draft's existence is verifiable, its posting is not a capability of this harness.

## Anti-patterns
- "Done — the invoice has been issued" on an `EXECUTION_SUCCEEDED` status, or describing `VERIFICATION_FAILED` as "the system is still catching up".
- Retrying `invoice.issue` because the first verification failed, or reporting a verified effect without naming the identifier the checks compared.
- Treating a read payload's status line as a verification of a prior commit.
