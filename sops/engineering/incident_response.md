# Incident Response - Containment, Preservation, Analysis, and Closure

## Objective
Handle the incident classes this harness can actually have without destroying the evidence that explains
them: contain the effect, preserve the journal, analyse from records, remediate with a regression test, and
close only with a written root cause. An incident is never resolved by editing the journal.

## Prerequisites
- The journal is the artefact: the append-only, hash-chained JSONL under the evidence directory, readable
  with `:evidence` and verifiable with `:verify-chain`. Copy the file; never edit, truncate, renumber, or
  repair a record - a rewrite is itself an incident.
- Containment levers, all trusted surfaces: stop the process (permits and confirmations are in-memory and
  do not survive), disable the affected capability (see `capability_deactivation.md`), set
  `adapters.<kind>.enabled:false`, change provider or model, or disconnect the machine.
- There is no automatic retry. For a mutation whose outcome is unknown, the harness does not retry and does
  not claim success; a human reconciliation is required.
- One responder is named; one record is kept in `COLLABORATOR_AGENT_NOTES.md`.
- Closure rule: no incident is closed without a written root cause naming the mechanism and a regression
  test that fails on the pre-fix revision.

## Procedure
Order for every class: detect -> contain -> preserve -> analyse -> remediate -> verify -> close.
1. **An execution that should not have happened.** Contain: stop the process, disable the capability and
   any adapter that can reach the effect, restart. Preserve: copy the journal and mark the run's sequence
   range, from `USER_INSTRUCTION` to the terminal status. Analyse: read whether a permit was consumed for
   the exact proposalHash; whether the policy decision was `ALLOW` or a confirmation; whether the frozen
   proposal hash at confirmation equals the executed hash (argument substitution between confirmation and
   execution is the laundering path); whether a second model turn fell between them; whether the
   session-start configHash matches the reviewed configuration. Remediate: fix the defect; if none is
   found, the cause is unknown - keep containment and say so rather than closing.
2. **Verification failure that may hide a real effect (COMMIT_UNKNOWN).** No retry, no success claim.
   Contain: treat the capability as suspect and disable it until reconciled. Preserve: the
   `EXECUTION_STARTED` record with the frozen proposal and the adapter's failure shape. Analyse: re-read
   authoritative domain state through the capability's own read path - never the adapter's report. Record
   one of three outcomes as a clearly labelled reconciliation entry: effect absent, effect present, or state
   unreadable. Remediate: fix the transport/timeout cause and add a fixture that drops the response after
   the mutation. Re-execution is permitted only after reconciliation shows the effect absent, and only as a
   fresh instruction with new authority.
3. **Evidence tampering detected by chain verification.** Contain: stop the process and append nothing
   further to the affected journal. Preserve: copy the file and record the `:verify-chain` report - the
   first broken sequence number and the last intact one. Analyse: every record after the break is untrusted;
   treat the gap as a statement about what could have been changed, not as a data glitch. Remediate: never
   repair in place; start a new journal for future work, record the break and its window, and escalate - if
   the machine itself is compromised, local controls are not sufficient (threat-model assumption A-1).
4. **A secret appearing in the journal.** Contain: stop the process and restrict access to the file.
   Preserve: copy the journal; do not delete the record, because deletion breaks the chain and is tampering.
   Analyse: find the entry path - a redaction gap, a novel secret shape, an adapter header, a provider body,
   or free text carrying one. Remediate: revoke or rotate the credential outside the harness (the harness
   holds no credentials), close the redaction gap and remove the source, and add a regression test using a
   fixture value of the same shape. Write the incident record without repeating the secret.
5. **A configuration change that widened authority.** Contain: stop the process, restore the last reviewed
   configuration, restart, and check the journal's session-start configHash. Analyse: name every widened
   field (`riskAllowlist`, `grantedPermissions`, `requireConfirmationFor`, `adapters.http.enabled` or
   `baseUrl`, `exposure.domains`, `allowNonLocalProvider`) and read the evidence for decisions that changed
   because of it. If widened authority was exercised, treat each affected run as class 1. Remediate:
   configuration is reviewed like code (T-18) - add the review gate and a regression case for the diff that
   must be refused or journaled.
6. **Repeated malicious-looking proposals from the model.** Contain: remove the untrusted source that
   reached the prompt; do not argue with the model, and do not widen authority to make it work. Analyse:
   separate model defect from injected content, and locate the injection text in the input that reached the
   prompt (the journal holds the instruction text and the exposed set, not the whole prompt). Remediate:
   quarantine the source, add the exact input as a regression case in the security battery and a benchmark
   arm, and change model or prompt only with recorded evidence. The harness control holds regardless: an
   unexposed, disabled, or risk-excluded capability cannot execute.

## Gates
- G1: `:verify-chain` output recorded and the journal copied before analysis appends anything.
- G2: containment verified - process confirmed dead, capability absent from the snapshot by the
  `capability_deactivation.md` gates. "Probably stopped" is not containment.
- G3: every analysis claim cites a sequence number; no claim rests on memory or on the operator's account.
- G4: for class 2, no retry was issued and no success was claimed; the reconciliation entry is separate and
  labelled.
- G5: the root cause is written and a regression test exists that fails on the pre-fix revision.
- G6: the incident record contains no secret value.
- G7: closure is reviewed against the journal alone by someone who did not perform the analysis.

## Expected evidence
- Journal copy, the `:verify-chain` report, and the sequence ranges examined.
- Before and after configHash and registryHash, the snapshotId proving the capability's absence, and every
  refusal code observed during containment.
- The written root cause, the regression test name, and the class 2 reconciliation entry.
- The `COLLABORATOR_AGENT_NOTES.md` entry: class, timeline, evidence references, remediation, closure.

## Failure conditions
- The journal was edited, truncated, or tidied: stop; the incident now includes a truthfulness failure.
- A retry was issued for a mutation whose outcome was unknown: treat the duplicate as class 1.
- An analysis claim cannot be tied to a record: the claim is withdrawn, not softened.
- The root cause cannot be reproduced, or the regression test passes on the pre-fix revision: the incident
  is not closed.
- Containment depends on a prompt or a model instruction rather than a trusted surface: containment has not
  happened.

## Recovery/rollback
- Return to service through the verified path only: fix, then the regression test must fail against the
  pre-fix revision and pass against the fix, then re-enable through the `capability_deactivation.md`
  recovery battery.
- Keep the incident's journal and its copy; do not renumber records, do not reuse the session id, and do not
  start a replacement chain that claims continuity with a broken one.
- To roll back a configuration widening, restore the exact previous configuration and diff it to prove no
  unrelated entry moved.

## Completion criteria
- Written root cause naming the mechanism, the affected capability, and the evidence sequence numbers.
- A regression test exists that catches the failure on the pre-fix revision.
- Containment is proven (process dead, capability disabled, snapshot clean) and the journal is preserved,
  unedited, alongside its copy.
- The notes entry is complete, contains no secrets, and a reviewer can reconstruct the timeline from the
  journal without the author's help.
