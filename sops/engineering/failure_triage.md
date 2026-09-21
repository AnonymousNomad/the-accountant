# Failure Triage — Terminal Status and Evidence Event Playbook

## Objective
Diagnose any failed turn from the terminal status and the journal events that produced it, in fixed order,
without weakening a control and without converting a failure into a success-shaped result.

## Prerequisites
- Access to the CLI transcript and the evidence journal; `:evidence` and `:verify-chain` are the only
  supported inspection paths.
- `docs/matrices/FAILURE_MATRIX.md` open: every condition below maps to an `F-nn` row with a safe behaviour.
- The failing run's `runId` known; the last lifecycle event for that run is the primary evidence (I-5).

## Procedure
1. Read the terminal status and the last event for the run before doing anything else; never infer the cause
   from the user's description of what they expected.
2. For `PROVIDER_ERROR` (F-01..F-04): check that the provider process is running and reachable at the
   configured loopback `baseUrl`; check the model name exists; check `timeoutMs`; read the typed code
   (`PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_MODEL_MISSING`, `PROVIDER_BAD_RESPONSE`).
   Causes: absent runtime, wrong model, deadline too short, wrong payload shape, wrong runtime version.
   Do not: edit config to another model silently, retry inside the harness, or journal the raw response body.
   Escalate: only if a correct runtime still yields a malformed payload; keep the shape diagnostic, not the body.
3. For `REJECTED` (F-05..F-11, F-30): read `PROPOSAL_REJECTED` — parse position and bounded excerpt for
   `RESPONSE_NOT_JSON`, the violation list for envelope/argument errors, `UNKNOWN_CAPABILITY`,
   `CAPABILITY_NOT_EXPOSED`, or `PROPOSAL_ID_REPLAY`. Causes: prose or truncation, wrong `kind`, missing or
   extra fields, placeholders, stale capability id, model reusing an id. Do not: repair the JSON by hand,
   widen the exposed set to match a hallucinated id, or relax the schema. Escalate: to prompt/SOP tuning
   (`prompts/accounting-resident.sop.md`) when the same violation repeats across prompts.
4. For `DENIED` (F-12, F-13, F-16, F-20): read `POLICY_DECISION` and its typed reason
   (`PERMISSION_NOT_GRANTED`, `RISK_NOT_AUTHORIZED`, `ADAPTER_DISABLED`, missing binding, `POLICY_ERROR`,
   `PERMIT_NOT_FOUND`/`PERMIT_EXPIRED`). Causes: permission not granted, risk not allowlisted, adapter
   disabled or unbound, policy defect. Do not: add the permission or enable the adapter to make one turn
   pass, and never treat a `POLICY_ERROR` as permission. Escalate: config changes require a reviewed,
   recorded decision; a `POLICY_ERROR` is a defect and is escalated immediately.
5. For `CONFIRMATION_REJECTED` (F-14/F-15): check that the confirmation was armed in the current turn,
   unexpired against `confirmation.ttlSeconds`, unconsumed, and hash-matching the frozen proposal. Causes:
   stale or late `yes`, a second instruction, an ambiguous answer, a replay, a clock/TTL mismatch. Do not:
   re-arm automatically, reinterpret the user's text as consent, or extend the TTL to make it fit.
   Escalate: repeated mismatches on a normal human cadence indicate a UX/TTL defect — review the config value.
6. For `EXECUTION_FAILED` (F-21, H-8): read `EXECUTION_STARTED` then `EXECUTION_FAILED` with its code and the
   resolved binding (no secrets). Causes: HTTP error, timeout, refused redirect, missing required response
   field, ambiguous 2xx. Do not: retry automatically, treat a 200 as success, or verify an execution that
   did not complete. Escalate: to the collaborator's operation owner when an ambiguous body recurs; record
   the idempotency/read-back requirement.
7. For `VERIFICATION_FAILED` (F-22, F-24, H-4): read `EXECUTION_SUCCEEDED` then `VERIFICATION_FAILED` and the
   failing checks. Causes: partial effect, adapter lied, verifier defect, wrong read-back. Do not: downgrade
   it to a success, suppress a failing check, or re-run the action automatically — an effect may exist.
   Escalate: treat as an incident when an effect may have landed; a compensating action is an operator
   decision recorded in evidence, not harness behaviour.
8. For a journal chain failure (F-26, F-27): run `:verify-chain`; if a write failed, check disk space,
   permissions, and path; if the chain reports a mismatch, note the first broken sequence number and stop.
   Do not: rewrite, truncate, or edit journal records, and do not continue execution on a failing store.
   Escalate: chain breakage is treated as tampering until proven an I/O defect.
9. For a config failure (F-28, F-29): read the `CONFIG_INVALID` message and exit code; check unknown keys,
   types, `adapters.http.enabled` without `baseUrl`, and a non-loopback provider host. Do not: substitute
   defaults, start with a partially valid config, or set `allowNonLocalProvider` to work around an address.
   Escalate: any change to the config is a reviewed, journaled decision by the operator.

## Gates
- G1: the diagnosis names a terminal status, an evidence event, and an `F-nn` row before any fix is proposed.
- G2: the fix is a reviewed change to config, code, prompt, or the collaborator's operation — never a
  runtime improvisation, and never a loosened control.
- G3: the failing invocation is preserved in the journal; no record is deleted or rewritten.
- G4: after any fix, the affected battery (`npm run verify`; `npm run bench` when selection or parsing was
  involved) is re-run and its output recorded.

## Expected evidence
- The run's journal slice, the typed error code, the resolved binding, and the verifier check list.
- The fix diff with the reason, the `F-nn` reference, and the re-run command output.

## Failure conditions
- A failure is described as a success, or a partial execution is reported as none: process failure; escalate.
- Evidence is missing for a claimed execution: stop; an action without evidence is not diagnosable and must
  be treated as unverified.
- The same cause recurs after a recorded fix: load the failure-specific skill and re-open the diagnosis
  instead of retrying (fail once, stop, research, then act).

## Rollback / recovery
- For any policy, permission, TTL, or exposure change made during triage: revert it before the next normal
  run; authority widening is never left in place.
- After a chain break or an I/O failure: restore storage, start a fresh session, and re-run the instruction
  as a new action with new authority.
- Keep the failed run's directory and journal for post-mortem; do not clean it up.

## Completion criteria
- The cause is identified or explicitly labelled UNKNOWN with a named next evidence-gathering step.
- No control was weakened, no failure was converted to success, and the re-run evidence is recorded.
