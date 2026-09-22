# Failure-Injection Specification

How to prove the harness's failure behaviour against a real application **before** trusting it with
consequential writes. Injections run against a **staging copy** through a fault-injecting adapter
wrapper around the real binding — one fault mode per run, one operation per run, evidence captured
each time. Never inject against production; never request production credentials or customer data.

> **THE INVARIANT THIS SPEC EXISTS TO PROVE**
>
> ```
> POSSIBLE WRITE + UNKNOWN RESULT
>   → COMMIT_UNKNOWN
>   → RECONCILE
>   → NEVER BLINDLY RETRY
> ```
>
> Any retry that can violate this — in the harness, in the adapter, or in an upstream caller — is a
> defect, not a convenience.

## Injection method

| Element | How |
|---|---|
| Fault location | the adapter wrapper (between the harness and the real service), so the application is not modified |
| Fault modes | listed below; each is a one-line behaviour switch in the wrapper |
| Observation | CLI transcript + evidence journal (`:evidence`, `:verify-chain`) + the application's own state |
| Deterministic analogues | `tests/adapters.test.mjs`, `tests/security.test.mjs`, fixture cases `B25`–`B32` — the same classes, already proven against local fixtures |
| Real-system-only rows | F13–F15 (concurrency and UI state) require the real application and its toolbar/overlay paths |

## Injections

| # | Injection | Expected harness behaviour | Expected evidence | Invariant proved |
|---|---|---|---|---|
| F01 | Service unavailable (connection refused) | `EXECUTION_FAILED`, commit state `NOT_SENT`; no retry | typed failure code; no `EXECUTION_STARTED` success path | definite failure is not ambiguous |
| F02 | Malformed result (2xx, missing/garbage fields) | typed unexpected-response failure; never success; commit state classified | the response shape is named in the failure | a claim is not a fact |
| F03 | Permission denial (401/403) | `EXECUTION_FAILED` / `DENIED` with typed reason; no retry, no success | denial recorded; state unchanged | fail closed |
| F04 | Capability revoked after discovery | `REJECTED` — not in the snapshot / disabled | revocation visible in the journal | revocation beats a stale proposal |
| F05 | Stale capability snapshot | execution refused against the stale snapshot | snapshot identity in the journal | version-bound snapshots |
| F06 | Duplicate request (same instruction twice) | two distinct proposals, two permits; the second is not silently merged | distinct proposal ids; both recorded | one permit, one execution |
| F07 | Replayed permit | refused (`PERMIT_ALREADY_USED` / expired) | refusal reason recorded | one permit, one execution |
| F08 | Timeout before write (request never sent) | `EXECUTION_FAILED`, `NOT_SENT`; never `COMMIT_UNKNOWN` | commit state recorded | definite no-effect |
| F09 | Timeout during write (sent, response lost) | `COMMIT_UNKNOWN`; no retry | ambiguity recorded; reconcile instruction surfaced | **the invariant** |
| F10 | Lost response after commit (service committed) | `COMMIT_UNKNOWN`; reconciliation finds the committed record; never re-issue | read-back reconciliation evidence | **the invariant** |
| F11 | Partial transaction (half a write lands) | the verifier detects the mismatch → `VERIFICATION_FAILED`; the committed part is visible for reconciliation | verifier checks show the exact mismatch | verification is independent |
| F12 | Read-back disagreement (adapter lies, read is truth) | `VERIFICATION_FAILED`; never `EXECUTED_VERIFIED` | verifier checks recorded | a reply is a claim, not a fact |
| F13 | Concurrent conflicting request (two operators, one record) | the second operation is not assumed safe by its permit; post-execution verification reveals the conflict and reports it | both runs' evidence; the conflict is explicit | authority is bound, not assumed |
| F14 | Toolbar stale state | after a verified effect, the UI reconciles from the authoritative read-back; stale UI is never treated as truth | reconciliation path exercised | UI state is not evidence |
| F15 | Overlay stale state | same, independently for the overlay path | reconciliation path exercised | UI state is not evidence |

## Rules

- Every injection produces evidence; an injection whose evidence cannot be reconstructed is itself a
  finding (`AUDIT_REPORT_TEMPLATE.md`, class DEFECT).
- The harness must never convert an injected failure into a success-shaped result, and must never
  retry a possibly-committed write.
- A capability whose adapter cannot distinguish `NOT_SENT` from `UNKNOWN` is `UNVERIFIABLE` for that
  failure class; record it in the worksheet rather than shipping a plausible classifier.
- F13–F15 are only meaningful against the real application and its UI; run them last, after the
  capability is otherwise accepted.

## Exit criteria

All applicable injections observed with the expected behaviour and reconstructable evidence; the
`COMMIT_UNKNOWN` invariant unviolated in every run; every deviation recorded per
`AUDIT_REPORT_TEMPLATE.md`.
