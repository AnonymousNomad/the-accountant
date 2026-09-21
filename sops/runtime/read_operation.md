# Read Operation — Safe Reads and Verified Reporting

## Objective
Run READ capabilities safely, verify each result by re-reading, and report counts and identifiers rather
than dumping payloads.

## Prerequisites
- READ capabilities exposed for the turn: `customer.search`, `invoice.preview`, `ledger.query`.
- The reportable shape is known from capability metadata: count, bounded list, ids, statuses.
- Reads are still executions: each consumes a one-use permit bound to its proposal hash (I-1).

## Procedure
1. Choose the READ capability that answers the question exactly; do not use a read as a substitute for a
   mutation, and do not chain reads to imitate an effect the harness cannot perform.
2. Build arguments from the user's text only: a search `query`; an `invoiceId` matching `^INV-[0-9]{4}$`;
   or an optional `account`/`limit` for the ledger.
3. Propose the read and let policy decide. READ is not confirmation-required under the configured
   `requireConfirmationFor`, but the decision belongs to the harness — never predict or narrate it.
4. Treat the adapter's returned data as a claim. The registered verifier re-executes the same
   deterministic read and compares it with the claim (`read_reproduced`, `result_shape`). Only a passing
   verification makes the values trustworthy.
5. Report counts and ids: "3 customers matched; first CUS-0012 (Smith Electrical)". Do not paste whole
   records, emails, or line payloads into the transcript, the summary, or evidence; evidence is
   privacy-minimal — ids, hashes, statuses, safe summaries.
6. A verified empty result is a fact: report zero matches. Do not retry with changed terms and do not
   widen the query to produce an answer the user did not ask for.
7. If verification fails (`VERIFICATION_FAILED`), report that the read is not verified, do not present the
   earlier values as data, and do not silently re-run it.
8. If the values conflict with the request (different record, wrong customer, unexpected status), stop and
   report the discrepancy; reconcile per tool-result handling before proposing anything else.
9. Never perform arithmetic on read values: totals, balances, tax, and version math are the domain's; if a
   computed value is needed, read it from the domain.

## Gates
- G1: every reported value came from a `VERIFIED` read in this session, never from memory or a claim.
- G2: evidence contains no wholesale payloads or secrets — ids, statuses, counts, safe summaries only.
- G3: a read never mutates state; its declared side effects are `none` in capability metadata.
- G4: `VERIFIED` is the only path to reporting a read as fact (I-6).

## Expected evidence
- `AUTHORIZED`, `AUTHORITY_CONSUMED`, `EXECUTION_STARTED`, `EXECUTION_SUCCEEDED`, `VERIFIED` for the read,
  with counts and ids in the redacted data.
- `:evidence` for the slice; `:verify-chain` after any journal-write concern.

## Failure conditions
- Verification fails: `VERIFICATION_FAILED`, reported as not verified, no automatic re-run (F-22/F-24).
- The adapter claims data the re-read does not reproduce: same failure path; investigate, never downgrade
  to a success.
- Values reported from an unverified read or from model memory: process failure; disregard the report and
  re-read.

## Recovery / rollback
- Re-run the read only as a new instruction with new authority; repeat safety comes from the capability's
  declared idempotency (`naturally_idempotent`) and never from the HTTP method or habit.
- If a read cannot be verified, treat it as unavailable, report the status, and escalate.
- Never edit domain state or journal records to make a read agree.

## Completion criteria
- Every reported fact is backed by a `VERIFIED` read; counts and ids are reported; no payload dump and no
  unverified value appears anywhere in the transcript.
