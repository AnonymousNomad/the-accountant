# Real-Integration Acceptance Specification

The black-box acceptance test for the first real integration slice: **customer search/create** and
**invoice draft**. Adapter-independent: every scenario is stated in semantic capabilities and
observable harness surfaces, so it applies to any binding without naming anyone's endpoints.

This specification is an **acceptance criterion for a real integration**, not a description of what
the synthetic fixture already proves. The deterministic analogues are listed so the reader can see
which behaviours are already evidenced and which are still to be demonstrated against a real system.
A capability is not promoted from SYNTHETIC to INTEGRATED until every scenario below has been observed
with its expected outcome.

## How each scenario is observed

| Surface | What it proves |
|---|---|
| CLI transcript (`node src/cli.mjs --prompt "<instruction>"`, `--json` for the raw result) | the operator-visible outcome and exit code |
| Evidence journal (`:evidence`, `:verify-chain`) | the full chain: exposure → proposal → authority → execution → verification, hash-linked |
| The application's own state (authoritative read) | the effect actually happened — never a cache |
| Exit codes | 0 determinate · 1 failed · 2 could not run · 3 usage (documented in `src/cli.mjs`) |

Run against a **staging copy** of the application with a fault-injecting adapter wrapper (see
`FAILURE_INJECTION_SPEC.md`). Never against production, and never with production credentials or
customer data.

## Scenarios

| # | Scenario | Precondition | Action | Expected observable | Pass criterion |
|---|---|---|---|---|---|
| A01 | Existing customer lookup | a customer exists; `customer.search` bound with read-back | ask for the customer by name | `EXECUTED_VERIFIED` | verifier re-read authoritative state; the returned id exists and matches; no invented identifier |
| A02 | Nonexistent customer | no customer matches the name | same instruction | a truthful negative (empty result reported, or clarification) | no identifier is manufactured; state unchanged; evidence records the actual result |
| A03 | Customer creation | `customer.create` bound; read-back available | create a customer with explicit fields | `EXECUTED_VERIFIED` only after the read-back proves the record | exactly one record exists; no duplicate; fields match the request |
| A04 | Duplicate / conflict | an identifying duplicate already exists, or the app enforces uniqueness | create the same customer again | the application's conflict behaviour is surfaced truthfully | no silent duplicate counted as verified success; the worksheet's idempotency row is filled from observation |
| A05 | Invoice draft creation | `invoice.create_draft` bound; customer id known | prepare a draft with lines | `EXECUTED_VERIFIED` with the draft id and status DRAFT | the total is the **service-computed** total; evidence notes the draft has no posted effect |
| A06 | Customer resolution before invoice draft | instruction names the customer, not the id | "prepare a draft invoice for <name>" | the Resident resolves the name first (RETRIEVE BEFORE CLARIFY) | the resolved id appears in the proposal or a read execution is recorded; no unnecessary clarification |
| A07 | Unauthorized mutation | the actor's permissions do not include the mutation | attempt the mutation | `DENIED` or `REJECTED` | zero executions; the denial reason is recorded; state unchanged |
| A08 | Confirmation when required | a FINANCIAL capability with confirmation | (a) decline; (b) approve; (c) replay the approval | (a) `CONFIRMATION_REQUIRED` → `CONFIRMATION_REJECTED`; (b) → `EXECUTED_VERIFIED`; (c) authorizes nothing | exactly one execution per approval; no execution on decline or replay |
| A09 | Authoritative read-back | verifier reads authoritative state, not a cache | mutate with a disagreeing read-back (injection F12) | `VERIFICATION_FAILED` | no verified success on disagreement; the verifier's checks are in evidence |
| A10 | Verified success | — | any fully successful mutation | `EXECUTED_VERIFIED` | execution success and verified success are distinct in evidence; only ids/digests recorded, never whole payloads |
| A11 | Truthful failure | force a service failure (F01/F02) | attempt the operation | a determinate failure (`EXECUTION_FAILED` / `REJECTED` / `DENIED` / `VERIFICATION_FAILED`) | never a success-shaped result; the operator surface claims nothing unverified |
| A12 | Unsupported action | an operation outside the exposed capability set | instruct it | `UNSUPPORTED` | no approximation to a different capability; zero executions |
| A13 | Malformed service response | the service returns a response missing required fields (F02) | attempt the operation | typed unexpected-response failure | no success; no verification of a malformed claim; commit state classified correctly |
| A14 | Timeout before execution | the request never reaches the service (F08) | attempt the operation | `EXECUTION_FAILED` (definite no-effect) | commit state is `NOT_SENT`; never reported as `COMMIT_UNKNOWN` |
| A15 | Timeout after possible write | the request may have been transmitted (F09/F10) | attempt the operation | `COMMIT_UNKNOWN` | no blind retry by the harness; the operator is told to reconcile; evidence records the ambiguity |

## Deterministic analogues already in this repository

These are the same behaviours proven against the synthetic fixture; they support the acceptance run
but do not replace it.

| Scenario | Existing evidence |
|---|---|
| A01, A05 | fixture `B01`, `B02`, `B06`; acceptance `G01`; "a read is verified by re-reading the same deterministic state" |
| A03 | fixture `B04`; "a lying adapter is caught: the reported id does not exist in the store" |
| A06 | actionability suite branches 1–2 (name/number → identifier resolution) |
| A07, A08 | fixture `B11`, `B12`, `B13`, `B19`, `B33`, `B36`, `B37`; security `S04`, `S05`, `S07`; acceptance `G03`–`G05` |
| A09, A10 | verification suite ("a lying adapter is caught", "a verifier that reports one failing check fails the whole verification"); fixture `B29` |
| A11, A12 | fixture `B10`, `B22`, `B25`–`B27`; acceptance `G09`, `G10`; security `S08`–`S10` |
| A13 | "an endpoint that omits required response fields is treated as an unexpected response" |
| A14, A15 | fixture `B30`, `B31`, `B32`; "a timed-out non-idempotent request is COMMIT_UNKNOWN: not success, not failure, not retried" |
| A02, A04 | **no direct deterministic analogue** — these depend on the application's not-found and conflict semantics and are the first things to observe |

## Exit criteria

1. All 15 scenarios observed on the staging copy with the expected outcomes, each with evidence.
2. Every deviation recorded per `AUDIT_REPORT_TEMPLATE.md` (class + evidence + reproduction); no
   finding closed without verification or an accepted-risk statement naming who accepted it.
3. Any failure of A07, A09, A14 or A15 blocks promotion of the affected capability — those four are
   the safety-critical rows.
4. The capability's `CAPABILITY_MAPPING_WORKSHEET.md` row is complete and evidenced, including the
   idempotency class and the authoritative read-back path.
