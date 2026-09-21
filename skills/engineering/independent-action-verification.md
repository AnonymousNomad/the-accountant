---
name: independent-action-verification
description: Keeps execution success and verified success separate by re-reading authoritative domain state in src/evidence/verifier.mjs; use when registering a capability verifier, interpreting a VERIFICATION_FAILED result, or proving that a lying adapter is detected.
---

## Purpose
Produce facts, not echoes. The adapter's success flag and HTTP 200 are claims; verification must re-read authoritative domain state through a separate path and only then may the run be called verified. A failed verification is terminal, is reported as a failure, and is never downgraded or retried automatically.

## When to use
- Registering or reviewing a capability's verifier id (`src/registry/capability.mjs`, `src/evidence/verifier.mjs`).
- Writing or extending the synthetic domain checks in `src/domain/synthetic-accounting/verifiers.mjs`.
- Investigating `VERIFICATION_FAILED`, partial execution, or a mismatch between adapter report and observed state (F-22).
- Building or reviewing the lying-adapter test that proves the mechanism detects an incorrect effect (SAH-REQ-028, A-3).
- Deciding whether a real collaborator operation can be verified at all (H-4, A-2).

## When NOT to use
- Verifying the journal chain — that is `evidence-and-audit-journaling.md`'s `:verify-chain`.
- Verifying policy or permit correctness — invariants I-1..I-3 and their tests own that.
- Benchmark scoring of proposal quality — use `local-agent-benchmarking.md`.
- Trusting the adapter's own response as verification. If a capability has no read-back, it is not verifiable; do not fake it (H-4).

## Prerequisites
- Every capability declares a verifier id and a permission at registration; a missing verifier is a registration error at build time (I-10, F-25).
- The verifier has read-only access to the authoritative store and never calls the adapter's write path (DM-14, H-6).
- The frozen proposal snapshot (validated arguments) is available to the verifier as the expected-effect source (I-3).
- Deterministic synthetic state: the benchmark always starts from a fresh store (FAILURE_MATRIX recovery doctrine).

## Inputs
- The capability id, its registered verifier, and the frozen proposal arguments.
- Authoritative domain state read directly from `src/domain/synthetic-accounting/store.mjs`.
- The execution record (`EXECUTION_STARTED`, `EXECUTION_SUCCEEDED`/`EXECUTION_FAILED`) from the journal.

## Procedure
1. Confirm at registration time that the verifier id resolves in the verifier registry; refuse to register a capability without one (I-10, F-25).
2. Design the verifier around read-back: it reads the authoritative store through explicit read operations and ignores the adapter's return value entirely (DM-14, H-6).
3. Derive expected post-state from the frozen arguments of the exact proposal that was authorized, never from a re-parse or a later model turn (B-1, I-3).
4. Run verification only after `EXECUTION_SUCCEEDED`. If the adapter failed, do not attempt verification; the terminal status stays `EXECUTION_FAILED` (F-21).
5. Express each verifier as named checks with observed facts and a boolean outcome; keep every check deterministic and side-effect free.
6. Require all checks to pass before emitting `VERIFIED`; any failing check produces `VERIFICATION_FAILED` with the failing check list (I-6).
7. Catch verifier exceptions and fail closed: `VERIFICATION_FAILED`, with the exception recorded as a check failure (F-24).
8. For partial or optimistic execution, keep the same result: `EXECUTION_SUCCEEDED` followed by `VERIFICATION_FAILED`; the CLI must print that an effect may exist and verification failed (F-22, H-5).
9. Never retry, never compensate automatically, and never convert a failure into a success-shaped status; compensation is out of scope and would need the collaborator's transaction semantics (DM-15, H-5).
10. For a real operation without a read-back, either pair it with a read-back or declare the capability unverifiable, which forbids `EXECUTED_VERIFIED` for it and is recorded as an integration blocker (H-4, A-2).
11. Add a lying-adapter test: an adapter that reports success without changing state must yield `VERIFICATION_FAILED` and never `EXECUTED_VERIFIED` (SAH-REQ-028, DM-14).
12. Mutation-check the verifier itself: break the state change or the adapter, confirm the verifier fails, then restore; record the drill (A-3 verification method).
13. Journal the check outcomes on the same `runId` as the execution so status and evidence agree (I-5, SAH-REQ-024).

## Decision points
| Condition | Action |
|---|---|
| Capability has no registered verifier | Registration error at build time; capability cannot be exposed (F-25) |
| Adapter failed | Skip verification; terminal `EXECUTION_FAILED` (F-21) |
| Adapter reported success, state unchanged or incomplete | `VERIFICATION_FAILED` with failing checks (F-22) |
| Verifier throws | `VERIFICATION_FAILED`, exception recorded as a check failure (F-24) |
| Real operation has no read-back | Pair a read-back or declare unverifiable; record the blocker (H-4) |
| Verification failed | Report failure, terminate; no automatic retry or compensation (H-5, DM-15) |

## Failure conditions
- All checks pass but the run is not marked verified — an invariant violation (I-6).
- A partial execution is reported as verified — the F-22 defect this skill exists to prevent.
- A verifier reads through the adapter's write path, verifying the adapter's opinion (H-6).
- A verifier is registered but never exercised for a capability — an untested control (A-3).

## Stop conditions
- Someone proposes `ok:true` or HTTP 200 as sufficient verification — stop; that is the defect.
- A capability would ship with a verifier that reads the adapter's own response — stop.
- Verification failure is about to be reported as success, partial success, or "still fine" — stop.
- A verification failure is about to be retried automatically to make it pass — stop (DM-15).

## Security considerations
- Verification is the last boundary before a claim of success; weakening it converts every other control into decoration (T-14, T-15).
- The verifier is harness code reading harness-owned state; the model cannot influence which checks run or their inputs (R-26, R-29).
- Verification failure that may imply a partial external effect must surface as a distinctive status with an explicit warning (H-5).
- A wrong verifier passing a bad execution is a recorded residual; review and mutation drills are the mitigation (T-15, A-3).

## Verification
- `tests/verification.test.mjs` asserts: a lying adapter yields `VERIFICATION_FAILED`; a verifier exception yields `VERIFICATION_FAILED`; a missing verifier fails registration (SAH-REQ-027, SAH-REQ-028, F-24, F-25).
- `tests/acceptance.test.mjs` asserts the full lifecycle ends in `EXECUTED_VERIFIED` only through a `VERIFIED` event, and that `invoice.issue` state is read from the store (SAH-REQ-017, I-6).
- `tests/security.test.mjs` asserts no path produces verified success without a verifier run (SAH-REQ-040).
- Record the lying-adapter drill output and the fresh-store state in `docs/EVIDENCE.md`.

## Expected outputs
- A registered verifier per capability, a normalised check list on every run, a `VERIFIED` or `VERIFICATION_FAILED` journal event with observed facts, and a detection test that fails if the mechanism regresses.

## Dependencies
- `src/evidence/verifier.mjs`, `src/domain/synthetic-accounting/verifiers.mjs`, `src/domain/synthetic-accounting/store.mjs`.
- `src/registry/capability.mjs` (verifier declaration), `src/harness.mjs` (status transition), `src/evidence/journal.mjs`.
- `tests/helpers/fixtures.mjs` (lying adapter fixture).

## References
- R-41 BFCL v3 state plus trace checks; aborts count as failures (PRIMARY).
- R-40 BFCL deterministic execution-grounded scoring (PRIMARY); R-39 draft versus posted state and reversal (AUTHORITATIVE SECONDARY).
- R-29 complete mediation (PRIMARY); R-33 TOCTOU: verify after the check-and-act span (STANDARD).
- R-26 excessive agency (STANDARD); R-27 untrusted model output (STANDARD).
- Decisions DM-14, DM-15; threats T-14, T-15; failures F-21..F-25; invariants I-6, I-10; assumption A-3; critic items H-4, H-5, H-6.

## Examples
- `invoice.issue` verifier: read the invoice by the id in the frozen arguments; check it exists, its state is `ISSUED`, and the transition is the one the capability declares. A second issue attempt must remain `DRAFT`-impossible and fail.
- `customer.create` verifier: read the store and confirm the created customer id exists with the exact validated name and email; the adapter's returned body is ignored.
- Lying-adapter drill: register a test adapter for `journal.propose` that returns `ok:true` without writing a draft; confirm the verifier fails the run and the status is `VERIFICATION_FAILED`, not `EXECUTED_VERIFIED`.
- Unverifiable path: a hypothetical operation with no read-back is marked unverifiable in the integration contract and can never reach `EXECUTED_VERIFIED`.

## Anti-patterns
- Marking success because the adapter returned `ok:true` or a 200.
- "Verifying" by re-reading the adapter's own response object.
- Re-parsing a later model turn to decide what was executed.
- Adding `try/catch` around a verifier that swallows the failure.
- Downgrading `VERIFICATION_FAILED` to a warning or an "inconclusive" status.
- Registering a placeholder verifier that always returns true.
