---
name: evidence-and-audit-journaling
description: Writes and verifies the append-only, hash-chained, redacted evidence journal that explains every action; use when emitting lifecycle events, adding a record type, implementing or testing src/evidence/journal.mjs, or diagnosing a broken chain or leaked secret.
---

## Purpose
Make every meaningful step leave tamper-evident evidence, and make the journal the only accepted account of what happened. One JSONL record per event, chained by `seq` and `prevHash`, redacted on every field, outside model reach, and reconstructible per run.

## When to use
- Emitting or changing lifecycle events from `src/harness.mjs` (proposal, policy, authority, execution, verification).
- Implementing redaction, hashing, or chain verification in `src/evidence/journal.mjs`.
- Adding a new record type or metadata field (provider usage, exposure set, confirmation source).
- Investigating a chain mismatch (F-27) or a suspected secret leak (T-13).

## When NOT to use
- Building a second logging channel, dashboard, or telemetry sink. Evidence is local files only; no telemetry (Sovereign constraint).
- Storing business state. The journal records events; the synthetic store owns state.
- Using the journal as memory or training data. v0.1 has no memory loop and no fine-tuning (SAH-REQ-056).
- Signing or external anchoring the chain. Key custody is deferred with a recorded trigger (DM-11, T-12 residual).

## Prerequisites
- `evidence.dir` configured (`var/evidence` by default) and writable; write failure is fatal, not cosmetic (F-26).
- A defined canonical subset for hashing that does not depend on object key order (see `src/core/canonical.mjs`).
- Redaction key list fixed in code, not configurable (H-10): password, secret, token, key, credential, authorization.
- The event vocabulary agreed: at minimum `PROPOSED`, `DENIED`, `AUTHORIZED`, `EXECUTION_STARTED`, `EXECUTION_SUCCEEDED`, `EXECUTION_FAILED`, `VERIFIED`, `VERIFICATION_FAILED` (ARCHITECTURE §3.4).

## Inputs
- Event type, `sessionId`, `runId`, `proposalId`, `proposalHash`, `capability`, `risk`, `permitId`.
- Event-specific `data` (frozen arguments, policy reason, confirmation source, failing checks, usage metadata).
- The previous record's `hash`, or the defined sentinel for the first record.

## Procedure
1. Open the journal file in append mode per session; never rewrite, truncate, or reorder records (DM-11, R-36).
2. Assign a monotonic `seq` and compute `hash` over the canonical record subset including `prevHash`; chain each record to the previous one (R-53).
3. Emit the required lifecycle events for every run, plus the supporting events the architecture enumerates (`USER_INSTRUCTION`, `CAPABILITIES_EXPOSED`, `PROPOSAL_REJECTED`, `CLARIFICATION_REQUESTED`, `UNSUPPORTED_REQUEST`, `POLICY_DECISION`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_GRANTED`, `CONFIRMATION_REJECTED`, `AUTHORITY_CONSUMED`, `PROVIDER_ERROR`, `SESSION_CLOSED`) (AU-2 via R-36).
4. Redact every string field before hashing, using the fixed pattern set for tokens, JWTs, private keys, basic-auth strings, and key/secret/password/credential/authorization shapes (R-53, T-13).
5. Never journal header values, credentials, or raw provider/adapter bodies; journal shape, status, and diagnostics only (F-04, M-2).
6. Carry correlation fields on every action record so a run can be reconstructed end to end from evidence alone (SAH-REQ-025).
7. Write pre-execution evidence durably before invoking the adapter. If it cannot be written, abort before execution: fail closed (F-26).
8. Write post-execution evidence after the synchronous consume-then-execute span. If the write fails, keep the failure status and exit non-zero with the I/O error (F-26, H-2).
9. Store the accepted arguments verbatim on the frozen proposal snapshot so the audit artefact is independent of any later model output (R-28).
10. Provide `:verify-chain`: replay records, recompute hashes, and report the first broken `seq`; still print remaining records while marking the chain invalid (F-27, T-12).
11. Provide `:evidence` rendering through the same redaction path as the file, scoped to a session or run (T-13).
12. Record the config hash and session identity at session start; configuration is a trusted boundary and must be attributable (T-18).
13. Treat retention as deferred: rotation/retention triggers only when a real deployment exists (AU-11, M-6); state the trigger rather than guessing a policy.

## Decision points
| Condition | Action |
|---|---|
| Pre-execution evidence cannot be written | Abort before execution; no adapter call (F-26) |
| Post-execution evidence cannot be written | Keep failure status; exit non-zero with the I/O error (F-26) |
| Chain verification finds a mismatch | Report the first broken `seq`; the journal is no longer trustworthy beyond it (F-27) |
| A field matches a redaction pattern | Replace with a typed placeholder before hashing (T-13) |
| A new record type is requested | Add it to the event vocabulary and a test that emits it; never emit an unlisted ad-hoc record |
| Volume or retention becomes a concern | Record the AU-11 trigger; do not implement rotation without a deployment requirement (M-6) |

## Failure conditions
- `EVIDENCE_WRITE_FAILED` with a non-zero exit code (F-26).
- Chain mismatch at a specific `seq` (F-27).
- Redaction miss for a new secret shape; accepted residual with the mitigation that headers are never journaled (T-13, M-2).
- Unverifiable full-chain rewrite by a privileged local actor; accepted residual, no key signing in v0.1 (T-12, A-12).

## Stop conditions
- Any proposal to buffer evidence writes past the pre-execution barrier — stop; ordering is the control.
- Any proposal to log a raw provider or adapter body for convenience — stop.
- Any proposal to make redaction configurable or disable it for a debugging session — stop.
- External log shipping, telemetry, or a remote evidence store — stop; sovereign only.

## Security considerations
- Append-only plus hash chaining makes modification detectable from the first altered record (R-36 AU-9, R-53).
- Redaction runs on every string field before hashing so secrets cannot be reintroduced through `data` (T-13).
- Evidence lives outside model reach; the model never receives journal contents, credentials, or internal routes (ARCHITECTURE §5).
- Tamper-evidence is not tamper-proof: a privileged local actor can rewrite the whole chain; stated, not hidden (T-12, A-7, A-12).
- Success wording may not outrun evidence: only the status enum and CLI rendering describe outcomes (H-9).

## Verification
- `tests/evidence.test.mjs` asserts chain verification, tamper detection at a chosen sequence number, redaction on every record, run reconstruction from correlation fields, and metadata recording (SAH-REQ-024..SAH-REQ-026).
- `tests/acceptance.test.mjs` asserts the last lifecycle event matches the terminal status for each `runId` (I-5).
- `tests/security.test.mjs` asserts no injected secret reaches the journal and failures never produce a success-shaped record (SAH-REQ-039, SAH-REQ-040).
- Run `:verify-chain` after a full battery and record the command and output in `docs/EVIDENCE.md`.

## Expected outputs
- An append-only JSONL journal with monotonic `seq`, a valid hash chain, redacted fields, and a per-run event sequence that explains the terminal status.

## Dependencies
- `src/evidence/journal.mjs`, `src/core/canonical.mjs`, `src/core/util.mjs` (clock and id generation), `src/core/errors.mjs`.
- `src/harness.mjs` (event emission), `src/cli.mjs` (`:evidence`, `:verify-chain`).
- `config/harness.config.json` (`evidence.dir`).

## References
- R-36 audit logging integrity, NIST SP 800-92 and SP 800-53 AU-2/AU-9/AU-11 (STANDARD).
- R-53 reference evidence chain, append-only JSONL with chain verification and redaction (reference implementation source).
- R-28 temperature-0 nondeterminism (AUTHORITATIVE SECONDARY); R-35 idempotency versus single-use authority (STANDARD + AUTHORITATIVE SECONDARY).
- Decisions DM-11, H-10 minimality, H-2 atomic span; failures F-26, F-27; threats T-12, T-13, T-18.

## Examples
- Lifecycle for `invoice.issue`: `PROPOSED` (frozen arguments) then `POLICY_DECISION` (`CONFIRMATION_REQUIRED`, risk FINANCIAL) then `CONFIRMATION_GRANTED` then `AUTHORIZED` then `EXECUTION_STARTED` then `EXECUTION_SUCCEEDED` then `VERIFIED`, with `seq` unbroken and each record reaching the previous `hash`.
- Tamper drill: flip one byte in a copied journal, run `:verify-chain`, and confirm the report names the altered `seq` and marks the chain invalid.
- Redaction drill: craft a record whose `data` embeds a bearer token and a private-key header; confirm both are replaced before hashing and that `:evidence` shows the placeholders.
- Reconstruction: given only the journal and a `runId`, rebuild the instruction, exposed set, policy reason, approved arguments, permit binding, execution result, and verification checks.

## Anti-patterns
- Logging for humans first and evidence second (free text with secrets inside).
- Non-monotonic or reused `seq` values; parallel writers without a lock.
- Recomputing `prevHash` "to repair" a mismatch instead of reporting it.
- Journaling the model's prose instead of the frozen validated object.
- Silent retry of an evidence write until it succeeds, hiding the ordering violation.
- Claiming a run is verified because a `VERIFIED` line was added by a test helper rather than by the verifier.
