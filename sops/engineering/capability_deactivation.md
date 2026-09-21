# Capability Deactivation - Removing a Capability from Execution Reach

## Objective
Remove exactly one capability from the harness's execution reach through trusted configuration or its
registry entry, and prove by evidence that it is not exposed in the capability snapshot, cannot receive
authority, and cannot execute - including from a permit or a confirmation that existed before the change.
Fail closed: an unproven deactivation is an open exposure, not a completed task.

## Prerequisites
- The capability is named unambiguously: id, version, definitionHash, and every trusted entry that carries
  it (registry registration or definition, exposure domains, adapter binding, permissions, verifier).
- A reason is written down (suspected unsafe effect, verifier defect, adapter withdrawn, incident
  containment, deprecation). "No reason given" is not a valid deactivation.
- The evidence journal is intact: `:verify-chain` has been run and its output recorded. A broken chain is
  handled by `incident_response.md` before anything is changed.
- The current configHash and registryHash are captured and the journal is copied (copied, never edited),
  so the before and after state is diffable and reproducible.
- The change is one reviewable change on a branch; no other capability, permission, or domain moves in it.

## Procedure
1. State the window: requests naming the capability will be refused until the battery below passes. Do not
   delete domain state or journal records to tidy up.
2. Run `:verify-chain` first and record the report, including the first broken sequence number if any.
3. Apply enforcement at the trusted surface, in this order:
   a. the capability entry's `enabled: false` in the trusted registry definition (primary switch);
   b. where the capability is registered by code in the composition root, removing the registration is the
      same control expressed as absence;
   c. `enabled:false` on an adapter, a missing binding, and removal from `exposure.domains` are additional
      layers, never the only control.
   Never deactivate by editing a prompt, a system text, a CLI flag, or by asking the model to ignore the
   capability. None of those are enforcement, and none of them are testable as control.
4. Restart the harness. Configuration and the registry are read and sealed at startup, so a running process
   keeps the old snapshot. Confirm the session-start evidence carries the new configHash and registryHash.
5. Verify absence from the snapshot: build the capability context for a task whose text would previously
   have selected it. The id must not appear in `ids`, `descriptors`, or the rendered `text`; record
   snapshotId, contextHash, registryHash, and the exclusion reason reported for it, if any.
6. Verify a proposal naming it is refused: submit the exact id and a casing/whitespace variant, and record
   the typed code - `UNKNOWN_CAPABILITY` when the registration is gone, `CAPABILITY_NOT_EXPOSED` when it
   remains registered but unexposed. A generic error is not proof of the control.
7. Verify pending authority cannot use it: with a pre-change permit still in the issuing process, attempt
   consumption and record the typed refusal; then restart and show that no permit survives a restart
   (permits are in-memory and restart discards all authority).
8. Verify an in-flight confirmation cannot execute it: resolve any confirmation armed before the change and
   expect `CONFIRMATION_REJECTED`. Then read the journal forward from the change and confirm there is no
   `AUTHORIZED`, `EXECUTION_STARTED`, `EXECUTION_SUCCEEDED`, or `VERIFIED` record for the id.
9. Record the change in `COLLABORATOR_AGENT_NOTES.md`: capability id and version, reason, the exact diff,
   before and after hashes, the evidence file and sequence range, every refusal code observed, the
   approver, and the conditions under which re-enabling is permitted.
10. Keep the disabled entry or the removal diff. Never erase the fact that the capability existed.

## Gates
- G1: chain verification output recorded before the change.
- G2: the id is absent from the exposed set for a task that would select it, with snapshotId and reason recorded.
- G3: a proposal naming it is refused with a typed code, on both the exact id and a variant.
- G4: no permit - old or new - can produce execution of the id.
- G5: an armed confirmation cannot resolve to execution of the id.
- G6: zero post-change evidence records of `AUTHORIZED`, `EXECUTION_STARTED`, `EXECUTION_SUCCEEDED`, or
  `VERIFIED` for the id.
- G7: the notes entry exists and the diff touches only the intended entries.

## Expected evidence
- The configuration/registry diff and the before/after configHash, registryHash, snapshotId, contextHash.
- Refusal records with their exact codes and sequence numbers, and the `:verify-chain` report.
- A copy of the journal covering the change window (the original is left untouched).
- The `COLLABORATOR_AGENT_NOTES.md` entry naming reason, approver, and re-enable conditions.

## Failure conditions
- The id still appears in the exposed set after restart: stop; the enforcement point is wrong (commonly a
  sealed registry still running, or a change made in a copy that is not the loaded config). Treat it as an
  open exposure.
- A refusal returns a generic error or a success-shaped result: stop; the control is unproven.
- A pre-change permit or confirmation can still execute the id: stop and open an incident (class: an
  execution that should not have happened).
- Evidence cannot be written (journal I/O failure): execution must not start; if it already started, the
  status stays a failure and the operator is told. Never downgrade a failure to keep a change moving.
- Any other capability's exposure, risk, permission, or confirmation behaviour changed in the same change:
  revert and split the change.

## Recovery/rollback
- Re-enabling runs the same battery in reverse: restore the entry, restart, prove the id is exposed for a
  task that should select it, prove its risk class, permission, confirmation requirement, adapter binding,
  and verifier are unchanged from before, then run `npm run verify` and the benchmark arm that covers it
  (the `capability_onboarding.md` gates).
- A capability disabled for cause is not re-enabled until the defect is fixed and a regression test exists
  that fails on the pre-fix revision (the `incident_response.md` closure rule).
- When the deactivation also touched exposure or adapter configuration, roll back the whole change, not
  just the flag, and diff the result to prove only the intended entries moved.
- Never rewrite the journal to hide the deactivation window.

## Completion criteria
- The capability cannot be exposed, cannot receive authority, and cannot execute, proven by the refusals
  and the forward journal read.
- The change is recorded with hashes, sequence numbers, codes, reason, approver, and re-enable conditions.
- A reviewer starting from the repository and the journal alone can reproduce every gate above without
  asking the author what happened.
